import { getAgentByName } from "agents";
import { runAgentTurn } from "./agent";
import { shapeDigest } from "./github-activity";
import type { FlueAgent } from "./agent";
import type { GithubEvent } from "./github-activity";
import type { Inbox } from "./inbox";

export { FlueAgent } from "./agent";
export { Inbox } from "./inbox";

export interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  AI: {
    run(model: string, payload: unknown): Promise<unknown>;
  };
  FlueAgent: DurableObjectNamespace<FlueAgent>;
  Inbox: DurableObjectNamespace<Inbox>;
  INBOX_TOKEN: string;
  X402_ENABLED?: string;
  X402_PAY_TO?: string;
  X402_VERIFIER?: {
    verify(proof: string): Promise<string | null>;
  };
}

function timingSafeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  const n = Math.max(x.length, y.length);
  let diff = x.length === y.length ? 0 : 1;
  for (let i = 0; i < n; i++) {
    diff |= (x.length > 0 ? x[i % x.length] : 0) ^ (y.length > 0 ? y[i % y.length] : 0);
  }
  return diff === 0;
}

function parseCookies(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    cookies.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  return cookies;
}

function jsonrpcError(id: unknown, code: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: {
    message?: {
      messageId?: unknown;
      parts?: unknown;
    };
  };
}

async function handleAgentRpc(request: Request, env: Env): Promise<Response> {
  let body: JsonRpcRequest;
  try {
    body = (await request.json()) as JsonRpcRequest;
  } catch {
    return jsonrpcError(null, -32700, "Parse error");
  }
  if (
    !body ||
    typeof body !== "object" ||
    body.jsonrpc !== "2.0" ||
    typeof body.method !== "string"
  ) {
    return jsonrpcError(body?.id ?? null, -32600, "Invalid Request");
  }
  if (body.method !== "message/send") {
    return jsonrpcError(body.id ?? null, -32601, "Method not found");
  }
  const message = body.params?.message;
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  const text = parts
    .filter(
      (p): p is { kind: string; text: string } =>
        !!p && typeof p === "object" && (p as { kind?: unknown }).kind === "text" &&
        typeof (p as { text?: unknown }).text === "string",
    )
    .map((p) => p.text)
    .join("\n");
  let reply: string;
  try {
    reply = await runAgentTurn(env, [], text);
  } catch {
    return jsonrpcError(body.id ?? null, -32603, "Internal error");
  }
  return Response.json({
    jsonrpc: "2.0",
    id: body.id ?? null,
    result: {
      id: typeof message?.messageId === "string" ? message.messageId : crypto.randomUUID(),
      status: {
        state: "completed",
        message: { role: "agent", parts: [{ kind: "text", text: reply }] },
      },
    },
  });
}

async function handleInbox(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  const expected = env.INBOX_TOKEN ?? "";
  if (!expected || !token || !timingSafeEqual(token, expected)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const raw = new URL(request.url).searchParams.get("after");
  const parsed = raw === null ? 0 : Number(raw);
  const after = Number.isFinite(parsed) ? parsed : 0;
  const contacts = await env.Inbox.get(
    env.Inbox.idFromName("inbox"),
  ).listContacts(after);
  return Response.json({ contacts });
}

const SESSION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const X402_ANON_LIMIT = 20;
const X402_PAID_LIMIT = 200;
// Placeholder network until the real payment network is decided.
const X402_NETWORK = "base-sepolia";

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function paymentRequired(reason: string, payTo: string | undefined): Response {
  // Fail closed while the wallet is undecided: no accepts entry, and the
  // header reports network=undecided rather than aiming payers at the zero
  // address.
  const accepts = payTo
    ? [
        {
          scheme: "exact",
          network: X402_NETWORK,
          asset: "USDC",
          payTo,
          maxAmountRequired: "1000",
          resource: "gebheim.com agent access",
          description: "Daily quota exceeded; pay per request via x402.",
        },
      ]
    : [];
  const network = payTo ? X402_NETWORK : "undecided";
  return Response.json(
    {
      x402Version: 1,
      error: reason,
      accepts,
    },
    {
      status: 402,
      headers: {
        "X-Payment-Required": `x402; scheme=exact; network=${network}`,
      },
    },
  );
}

async function x402Gate(request: Request, env: Env): Promise<Response | null> {
  if (env.X402_ENABLED !== "true") return null;
  const day = new Date().toISOString().slice(0, 10);
  const inbox = env.Inbox.get(env.Inbox.idFromName("inbox"));
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const payment = request.headers.get("X-Payment");

  if (payment !== null) {
    const verifier = env.X402_VERIFIER;
    if (!verifier) {
      return paymentRequired("payment verification unavailable", env.X402_PAY_TO);
    }
    let payer: string | null;
    try {
      payer = await verifier.verify(payment);
    } catch (error) {
      console.error("x402 verifier threw", error);
      return new Response("payment verifier unavailable", { status: 503 });
    }
    if (typeof payer === "string" && payer.length > 0) {
      const key = await sha256Hex(`x402-paid:${day}:${payer}`);
      const count = await inbox.hitRateLimit(key, day);
      if (count > X402_PAID_LIMIT)
        return paymentRequired("paid quota exceeded", env.X402_PAY_TO);
      return null;
    }
    // Malformed or replayed proof: consume one anonymous count, fail closed.
    const anonKey = await sha256Hex(`x402-anon:${day}:${ip}`);
    await inbox.hitRateLimit(anonKey, day);
    return paymentRequired("invalid payment proof", env.X402_PAY_TO);
  }

  const key = await sha256Hex(`x402-anon:${day}:${ip}`);
  const count = await inbox.hitRateLimit(key, day);
  if (count > X402_ANON_LIMIT)
    return paymentRequired("anonymous quota exceeded", env.X402_PAY_TO);
  return null;
}

async function handleChat(request: Request, env: Env): Promise<Response> {
  if ((request.headers.get("Upgrade") ?? "").toLowerCase() !== "websocket") {
    return new Response("Expected a WebSocket upgrade", { status: 426 });
  }
  // Gate every upgrade: the server never records issued sessions, and the
  // widget mints flue_session client-side, so a cookie proves nothing. A
  // reconnect consumes from the anonymous bucket like a new session.
  const gated = await x402Gate(request, env);
  if (gated) return gated;
  const cookie = parseCookies(request.headers.get("Cookie")).get("flue_session");
  const existing = cookie && SESSION_ID_RE.test(cookie) ? cookie : undefined;
  const sessionId = existing ?? crypto.randomUUID();
  const stub = await getAgentByName(env.FlueAgent, sessionId);
  if (existing) return stub.fetch(request);
  const forward = new Request(request.url, request);
  forward.headers.set("x-flue-new-session", sessionId);
  return stub.fetch(forward);
}

const GITHUB_EVENTS_URL =
  "https://api.github.com/users/pgebheim/events/public";
const GITHUB_ACTIVITY_KEY = "context:github-activity";

async function refreshGithubActivity(env: Env): Promise<void> {
  try {
    const res = await fetch(GITHUB_EVENTS_URL, {
      headers: {
        "User-Agent": "gebheim-com-worker",
        Accept: "application/vnd.github+json",
      },
    });
    if (!res.ok) {
      console.error(`github activity refresh failed: HTTP ${res.status}`);
      return;
    }
    const events = (await res.json()) as GithubEvent[];
    const digest = shapeDigest(events);
    const value = `${digest}\n\nfetched_at: ${new Date().toISOString()}`;
    await env.Inbox.get(env.Inbox.idFromName("inbox")).kvSet(
      GITHUB_ACTIVITY_KEY,
      value,
    );
  } catch (error) {
    // Leave the prior digest intact when the fetch fails.
    console.error("github activity refresh failed", error);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/agent" && request.method === "POST") {
      const gated = await x402Gate(request, env);
      if (gated) return gated;
      return handleAgentRpc(request, env);
    }
    if (url.pathname === "/agent/inbox" && request.method === "GET") {
      return handleInbox(request, env);
    }
    if (url.pathname === "/api/chat") {
      return handleChat(request, env);
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    await refreshGithubActivity(env);
  },
};
