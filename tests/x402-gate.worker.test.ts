import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";

/**
 * Contract suite for the shipped x402 gate (issue #7) on POST /agent and
 * /api/chat.
 *
 * Review-driven correction: this suite previously pinned "a reconnect
 * carrying a valid flue_session cookie is not gated". That pin encoded the
 * bypass the review flagged — the server never records issued sessions and
 * the widget mints the cookie client-side, so any UUID-shaped cookie
 * skipped the gate. The reconnect tests below now pin quota consumption:
 * every upgrade is gated, cookie or not.
 *
 * Contract decisions pinned here:
 * - env.X402_ENABLED is the string "true" to enable the gate; any other value
 *   (including unset) disables it. Tests bind "false" in vitest.config.ts and
 *   flip it per test with the same env-override pattern as the AI mock.
 * - env.X402_VERIFIER is an optional binding shaped
 *   `{ verify(proof: string): Promise<string | null> }`. It resolves to the
 *   payer address on a valid payment and null on an invalid or replayed
 *   proof. When the binding is absent, any request carrying X-Payment gets
 *   402 "payment verification unavailable".
 * - env.X402_PAY_TO is the wallet advertised in the 402 accepts entry. While
 *   unset, the 402 body carries no accepts entry and the X-Payment-Required
 *   header reports network=undecided: the gate fails closed instead of
 *   pointing payers at a placeholder address.
 * - The Inbox DO keeps a rate_limits table (key TEXT PRIMARY KEY, day TEXT,
 *   count INTEGER) and two RPC methods:
 *     hitRateLimit(key, day): number — fixed-window increment. A row whose
 *       stored day differs from `day` resets to 1. Returns the new count.
 *       Lazily deletes rows from days older than `day` so the table does
 *       not grow unboundedly.
 *     rateLimitRows(): { key, day, count }[] — all rows, for test
 *       introspection.
 * - The gate covers POST /agent and every /api/chat WebSocket upgrade. A
 *   reconnect carrying a flue_session cookie consumes from the anonymous
 *   bucket like a new session; the cookie only resumes chat history.
 * - Anonymous tier: 20 requests per UTC calendar day, keyed by a sha256 hex
 *   digest (64 lowercase hex chars) of the client IP plus a daily salt. The
 *   raw IP never reaches storage.
 * - Paid tier: a valid X-Payment header raises the ceiling to 200 per UTC
 *   day, keyed by the payer address the verifier returns, not by IP.
 * - Over the limit the worker responds 402 with an X-Payment-Required header
 *   naming the x402 scheme and an accepted network.
 * - Fail closed: a malformed proof returns 402 and still consumes one
 *   anonymous count; a verifier that throws returns 402 or 503, never 200.
 */

interface RateLimitRow {
  key: string;
  day: string;
  count: number;
}

interface RateLimitInbox {
  hitRateLimit(key: string, day: string): Promise<number>;
  rateLimitRows(): Promise<RateLimitRow[]>;
}

const envRecord = () => env as unknown as Record<string, unknown>;

const inboxStub = () =>
  (env as unknown as { Inbox: DurableObjectNamespace }).Inbox.get(
    (env as unknown as { Inbox: DurableObjectNamespace }).Inbox.idFromName(
      "inbox",
    ),
  ) as unknown as RateLimitInbox;

/** Proof format the mock verifier accepts: "mock:<payer>:<nonce>". */
const PAYER = "0xpayerdeadbeef";
const proof = (nonce: string, payer = PAYER) => `mock:${payer}:${nonce}`;

interface MockVerifier {
  calls: string[];
  seen: Set<string>;
}

/**
 * Installs a recording mock as env.X402_VERIFIER. The mock accepts proofs of
 * the form "mock:<payer>:<nonce>", returns the payer, and rejects replays:
 * submitting the same proof bytes twice yields null the second time.
 */
function installMockVerifier(): MockVerifier {
  const seen = new Set<string>();
  const calls: string[] = [];
  envRecord().X402_VERIFIER = {
    verify: async (raw: string) => {
      calls.push(raw);
      const match = /^mock:([0-9a-zA-Z]+):([0-9a-zA-Z-]+)$/.exec(raw);
      if (!match) return null;
      if (seen.has(raw)) return null;
      seen.add(raw);
      return match[1];
    },
  };
  return { calls, seen };
}

function installMockAI(): void {
  envRecord().AI = { run: async () => ({ response: "MOCK_REPLY" }) };
}

function postAgent(ip: string, payment?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "CF-Connecting-IP": ip,
  };
  if (payment !== undefined) headers["X-Payment"] = payment;
  return SELF.fetch("https://gebheim.com/agent", {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "r1",
      method: "message/send",
      params: {
        message: {
          messageId: crypto.randomUUID(),
          parts: [{ kind: "text", text: "hi" }],
        },
      },
    }),
  });
}

function upgradeChat(ip: string, cookie?: string) {
  const headers: Record<string, string> = {
    Upgrade: "websocket",
    "CF-Connecting-IP": ip,
  };
  if (cookie) headers["Cookie"] = cookie;
  return SELF.fetch("https://gebheim.com/api/chat", { headers });
}

function acceptAndClose(res: Response): void {
  const ws = res.webSocket;
  if (ws) {
    ws.accept();
    ws.close();
  }
}

/** Sends n anonymous requests and asserts every one returns 200. */
async function expectAnonymousPass(ip: string, n: number): Promise<void> {
  for (let i = 1; i <= n; i++) {
    const res = await postAgent(ip);
    expect(res.status, `anonymous request ${i} of ${n}`).toBe(200);
  }
}

function expectPaymentRequired(res: Response): void {
  expect(res.status).toBe(402);
  const header = res.headers.get("x-payment-required") ?? "";
  expect(header).toMatch(/x402/i);
  expect(header).toMatch(/network/i);
}

beforeEach(() => {
  installMockAI();
  installMockVerifier();
  envRecord().X402_ENABLED = "true";
  delete envRecord().X402_PAY_TO;
});

describe("anonymous tier", () => {
  it("allows 20 requests per IP per UTC day, then returns 402 with X-Payment-Required", async () => {
    const ip = "203.0.113.1";
    await expectAnonymousPass(ip, 20);
    expectPaymentRequired(await postAgent(ip));
  });

  it("never gates when X402_ENABLED is not \"true\", even past the limit", async () => {
    envRecord().X402_ENABLED = "false";
    const ip = "203.0.113.3";
    await expectAnonymousPass(ip, 21);
  });

  it("resets the fixed window when the stored day differs from today", async () => {
    // Craft the boundary directly against the DO: a counter row dated
    // yesterday (UTC) must not count against today's window.
    const stub = inboxStub();
    const key = "a".repeat(64);
    for (let i = 0; i < 25; i++) {
      await stub.hitRateLimit(key, "2000-01-01");
    }
    expect(await stub.hitRateLimit(key, "2000-01-01")).toBe(26);
    expect(await stub.hitRateLimit(key, "2000-01-02")).toBe(1);
    const rows = await stub.rateLimitRows();
    expect(rows).toEqual([{ key, day: "2000-01-02", count: 1 }]);
  });

  it("lazily deletes rows from days older than the hit day", async () => {
    const stub = inboxStub();
    await stub.hitRateLimit("b".repeat(64), "2000-01-01");
    await stub.hitRateLimit("c".repeat(64), "2000-01-01");
    await stub.hitRateLimit("d".repeat(64), "2000-01-02");
    const rows = await stub.rateLimitRows();
    expect(rows).toEqual([{ key: "d".repeat(64), day: "2000-01-02", count: 1 }]);
  });

  it("stores a fixed-length sha256 key, never the raw IP", async () => {
    const ip = "203.0.113.7";
    await expectAnonymousPass(ip, 3);
    const rows = await inboxStub().rateLimitRows();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.key).toMatch(/^[0-9a-f]{64}$/);
      expect(row.key).not.toBe(ip);
      expect(row.key).not.toContain(ip);
    }
  });

  it("keeps independent counters for different IPs", async () => {
    const ipA = "203.0.113.8";
    const ipB = "203.0.113.9";
    await expectAnonymousPass(ipA, 20);
    expectPaymentRequired(await postAgent(ipA));
    const fromB = await postAgent(ipB);
    expect(fromB.status).toBe(200);
  });
});

describe("paid tier", () => {
  it("a valid payment raises the ceiling to 200/day keyed by payer, not IP", async () => {
    const ip = "203.0.113.6";
    // Requests 1-20 pass anonymously; the 21st hits the anonymous ceiling.
    await expectAnonymousPass(ip, 20);
    expectPaymentRequired(await postAgent(ip));

    // Requests 21-220 carry unique valid proofs and all pass. The DO
    // serializes hitRateLimit, so parallel batches cannot over-admit.
    for (let base = 1; base <= 200; base += 25) {
      const batch = Array.from({ length: 25 }, (_, i) => base + i);
      await Promise.all(
        batch.map(async (n) => {
          const res = await postAgent(ip, proof(`n${n}`));
          expect(res.status, `paid request ${n} of 200`).toBe(200);
        }),
      );
    }

    // The 201st paid request exceeds the paid ceiling, from any IP.
    expectPaymentRequired(await postAgent(ip, proof("n201")));
    expectPaymentRequired(await postAgent("203.0.113.66", proof("n202")));
  });

  it("a malformed proof returns 402, consumes one anonymous count, and does not crash", async () => {
    const ip = "203.0.113.4";
    await expectAnonymousPass(ip, 20);
    const malformed = await postAgent(ip, "not-a-valid-proof");
    expect(malformed.status).toBe(402);
    // The malformed attempt consumed count 21, so the next anonymous
    // request is still over the limit: the 402 did not reset the window.
    expectPaymentRequired(await postAgent(ip));
  });

  it("rejects a replayed proof: the same bytes twice yields 402 the second time", async () => {
    const ip = "203.0.113.5";
    const first = await postAgent(ip, proof("replay-1"));
    expect(first.status).toBe(200);
    const second = await postAgent(ip, proof("replay-1"));
    expect(second.status).toBe(402);
  });

  it("fails closed when the verifier throws: 402 or 503, never a silent allow", async () => {
    envRecord().X402_VERIFIER = {
      verify: async () => {
        throw new Error("verifier unavailable");
      },
    };
    const res = await postAgent("203.0.113.10", proof("boom-1"));
    expect([402, 503]).toContain(res.status);
  });

  it("returns 402 'payment verification unavailable' when X-Payment is present but no verifier is bound", async () => {
    delete envRecord().X402_VERIFIER;
    const res = await postAgent("203.0.113.40", proof("never-1"));
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("payment verification unavailable");
  });
});

describe("402 payment advertisement", () => {
  it("carries no accepts entry and reports network=undecided while X402_PAY_TO is unset", async () => {
    const ip = "203.0.113.30";
    await expectAnonymousPass(ip, 20);
    const res = await postAgent(ip);
    expect(res.status).toBe(402);
    const body = (await res.json()) as { accepts?: unknown[] };
    expect(body.accepts ?? []).toEqual([]);
    expect(res.headers.get("x-payment-required")).toContain(
      "network=undecided",
    );
  });

  it("advertises the configured wallet once X402_PAY_TO is set", async () => {
    envRecord().X402_PAY_TO = "0x000000000000000000000000000000000000dEaD";
    const ip = "203.0.113.31";
    await expectAnonymousPass(ip, 20);
    const res = await postAgent(ip);
    expect(res.status).toBe(402);
    const body = (await res.json()) as { accepts?: { payTo?: string }[] };
    expect(body.accepts?.[0]?.payTo).toBe(
      "0x000000000000000000000000000000000000dEaD",
    );
    expect(res.headers.get("x-payment-required")).toContain(
      "network=base-sepolia",
    );
  });
});

describe("GET /api/chat new-session creation", () => {
  it("gates new-session upgrades after 20 per IP per day", async () => {
    const ip = "203.0.113.20";
    for (let i = 1; i <= 20; i++) {
      const res = await upgradeChat(ip);
      expect(res.status, `new-session upgrade ${i} of 20`).toBe(101);
      acceptAndClose(res);
    }
    expectPaymentRequired(await upgradeChat(ip));
  });

  it("a reconnect within quota still upgrades 101", async () => {
    const ip = "203.0.113.21";
    const first = await upgradeChat(ip);
    expect(first.status).toBe(101);
    const cookie = /flue_session=[^;]+/.exec(
      first.headers.get("set-cookie") ?? "",
    )?.[0];
    expect(cookie).toBeDefined();
    acceptAndClose(first);

    const reconnect = await upgradeChat(ip, cookie);
    expect(reconnect.status).toBe(101);
    acceptAndClose(reconnect);
  });

  it("a cookie-carrying request past quota gets 402 like any other", async () => {
    const ip = "203.0.113.22";
    const first = await upgradeChat(ip);
    expect(first.status).toBe(101);
    const cookie = /flue_session=[^;]+/.exec(
      first.headers.get("set-cookie") ?? "",
    )?.[0];
    expect(cookie).toBeDefined();
    acceptAndClose(first);

    for (let i = 2; i <= 20; i++) {
      const res = await upgradeChat(ip);
      expect(res.status, `new-session upgrade ${i} of 20`).toBe(101);
      acceptAndClose(res);
    }

    // The reconnect consumes from the anonymous bucket like any new
    // session: request 21 from this IP is over quota, cookie or not.
    expectPaymentRequired(await upgradeChat(ip, cookie));
  });
});
