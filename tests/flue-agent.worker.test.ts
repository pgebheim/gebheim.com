import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import resumeRaw from "../public/resume.json?raw";

/**
 * RED suite for issue #4 (flue-agent).
 *
 * The implementation does not exist yet: src/agent.ts (FlueAgent DO, tools),
 * src/inbox.ts (Inbox DO), and the /agent, /agent/inbox, /api/chat routes in
 * src/worker.ts are all missing. Every test in this file fails until they land.
 *
 * Contract decisions pinned here:
 * - src/agent.ts exports `tools` (a record keyed by tool name) and
 *   `executeTool(name, args, { env })`. Each tool's execute takes
 *   `(args, { env })` and returns a string, except contact_paul which returns
 *   `{ received: boolean, id: string }`.
 * - env.AI is a Workers AI binding called as env.AI.run(model, payload) with a
 *   Llama 3.x model id; tests replace the binding with a recording mock.
 * - GET /agent/inbox requires `Authorization: Bearer ${env.INBOX_TOKEN}` and
 *   returns `{ contacts: [{ rowid, id, name, contact, message, created_at }] }`
 *   newest first.
 */

const resume = JSON.parse(resumeRaw) as {
  basics: { name: string };
  work: { name: string }[];
};

const MOCK_TEXT_REPLY = "MOCK_REPLY: Paul Gebheim works at Sei Labs";
const MOCK_TOOL_FOLLOWUP_REPLY = "MOCK_REPLY: done, Paul Gebheim has it";

interface AiMessage {
  role: string;
  content?: unknown;
}

interface AiCall {
  model: string;
  payload: {
    messages?: AiMessage[];
    tools?: { name?: string; function?: { name?: string } }[];
  };
}

interface MockAi {
  calls: AiCall[];
}

/**
 * Installs a recording mock as env.AI. The mock never emits model output worth
 * asserting on; tests assert the request shape recorded in `calls` instead.
 * Canned replies carry the MOCK_REPLY marker so socket/HTTP round-trips have a
 * deterministic string to look for.
 */
function installMockAI(): MockAi {
  const mock: MockAi = { calls: [] };
  const ai = {
    run: async (model: string, payload: AiCall["payload"]) => {
      mock.calls.push({ model, payload: JSON.parse(JSON.stringify(payload)) });
      const messages = payload.messages ?? [];
      const last = messages[messages.length - 1];
      // Second turn of a tool-use loop: the last message is the tool result.
      if (last && last.role !== "user") {
        return { response: MOCK_TOOL_FOLLOWUP_REPLY };
      }
      const text = typeof last?.content === "string" ? last.content : "";
      if (text.includes("RUN_CONTACT_PAUL")) {
        return {
          tool_calls: [
            {
              name: "contact_paul",
              arguments: {
                name: "Ada Lovelace",
                contact: "ada@example.com",
                message: "Let us collaborate",
              },
            },
          ],
        };
      }
      return { response: MOCK_TEXT_REPLY };
    },
  };
  (env as unknown as Record<string, unknown>).AI = ai;
  return mock;
}

let mockAI: MockAi;
beforeEach(() => {
  mockAI = installMockAI();
});

const importAgent = () => import("../src/agent");

const inboxToken = () =>
  (env as unknown as { INBOX_TOKEN: string }).INBOX_TOKEN;

function fetchInbox(query = "") {
  return SELF.fetch(`https://gebheim.com/agent/inbox${query}`, {
    headers: { Authorization: `Bearer ${inboxToken()}` },
  });
}

function fetchInboxWithHeaders(headers: Record<string, string> = {}) {
  return SELF.fetch("https://gebheim.com/agent/inbox", { headers });
}

function postAgent(body: string) {
  return SELF.fetch("https://gebheim.com/agent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

function messageSend(text: string, id = "req-1") {
  return postAgent(
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "message/send",
      params: {
        message: {
          role: "user",
          messageId: `msg-${id}`,
          parts: [{ kind: "text", text }],
        },
      },
    }),
  );
}

function upgradeChat(headers: Record<string, string> = {}) {
  return SELF.fetch("https://gebheim.com/api/chat", {
    headers: { Upgrade: "websocket", ...headers },
  });
}

/** Collects socket messages so tests can wait for one matching a predicate. */
function collect(ws: WebSocket) {
  const messages: string[] = [];
  const waiters: {
    pred: (s: string) => boolean;
    resolve: (s: string) => void;
  }[] = [];
  ws.addEventListener("message", (e) => {
    const data = String((e as MessageEvent).data);
    messages.push(data);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].pred(data)) {
        waiters[i].resolve(data);
        waiters.splice(i, 1);
      }
    }
  });
  return {
    messages,
    waitFor(pred: (s: string) => boolean, timeoutMs = 5000): Promise<string> {
      const existing = messages.find(pred);
      if (existing !== undefined) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new Error(
                `timed out waiting for a matching ws message; received: ${JSON.stringify(messages)}`,
              ),
            ),
          timeoutMs,
        );
        waiters.push({
          pred,
          resolve: (s) => {
            clearTimeout(timer);
            resolve(s);
          },
        });
      });
    },
  };
}

interface ContactRow {
  rowid: number;
  id: string;
  name: string;
  contact: string;
  message: string;
  created_at: string;
}

describe("agent tools", () => {
  it("resume returns content derived from public/resume.json", async () => {
    const { tools } = await importAgent();
    const text = await tools.resume.execute({}, { env });
    expect(text).toContain(resume.basics.name);
    expect(text).toContain(resume.work[0].name);
  });

  it("talks returns non-empty text", async () => {
    const { tools } = await importAgent();
    const text = await tools.talks.execute({}, { env });
    expect(typeof text).toBe("string");
    expect(text.trim().length).toBeGreaterThan(0);
  });

  it("how_was_i_built returns the colophon page content via env.ASSETS", async () => {
    const { tools } = await importAgent();
    const text = await tools.how_was_i_built.execute({}, { env });
    expect(text).toMatch(/cloudflare workers/i);
  });

  it("every tool has a description, a parameters schema, and an execute function", async () => {
    const { tools } = await importAgent();
    for (const name of ["resume", "talks", "contact_paul", "how_was_i_built"]) {
      const tool = tools[name];
      expect(tool, `tool "${name}"`).toBeDefined();
      expect(tool.description?.length).toBeGreaterThan(0);
      expect(tool.parameters).toBeTruthy();
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("executeTool returns a structured error for an unknown tool", async () => {
    const { executeTool } = await importAgent();
    const result = await executeTool("no_such_tool", {}, { env });
    expect(result).toMatchObject({ error: { code: "unknown_tool" } });
  });

  it("contact_paul generates an idempotency UUID when none is given", async () => {
    const { tools } = await importAgent();
    const result = await tools.contact_paul.execute(
      { name: "Ada", contact: "ada@example.com", message: "hi" },
      { env },
    );
    expect(result.received).toBe(true);
    expect(result.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("contact_paul inserts a row for a fresh idempotency key", async () => {
    const { tools } = await importAgent();
    const result = await tools.contact_paul.execute(
      {
        name: "Ada",
        contact: "ada@example.com",
        message: "hi",
        idempotencyKey: "key-fresh-1",
      },
      { env },
    );
    expect(result).toMatchObject({ received: true, id: "key-fresh-1" });
  });

  it("contact_paul delivers exactly once for a repeated idempotency key", async () => {
    const { tools } = await importAgent();
    const args = {
      name: "Ada",
      contact: "ada@example.com",
      message: "hi",
      idempotencyKey: "key-dup-1",
    };
    const first = await tools.contact_paul.execute(args, { env });
    const second = await tools.contact_paul.execute(args, { env });
    expect(first.received).toBe(true);
    expect(second.received).toBe(false);
    const res = await fetchInbox();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { contacts: ContactRow[] };
    const rows = body.contacts.filter((c) => c.id === "key-dup-1");
    expect(rows).toHaveLength(1);
  });
});

describe("Workers AI request shape", () => {
  it("sends a Llama 3.x request with a resume-derived system prompt and all four tools", async () => {
    const res = await messageSend("Tell me about Paul");
    expect(res.status).toBe(200);
    expect(mockAI.calls.length).toBeGreaterThan(0);
    const { model, payload } = mockAI.calls[0];
    expect(model).toMatch(/^@cf\/meta\/llama-3/);
    const messages = payload.messages ?? [];
    expect(messages[0].role).toBe("system");
    expect(String(messages[0].content)).toContain(resume.basics.name);
    expect(String(messages[0].content)).toContain(resume.work[0].name);
    const toolNames = (payload.tools ?? []).map(
      (t) => t?.name ?? t?.function?.name,
    );
    for (const name of ["resume", "talks", "contact_paul", "how_was_i_built"]) {
      expect(toolNames).toContain(name);
    }
    expect(messages[messages.length - 1].role).toBe("user");
    expect(String(messages[messages.length - 1].content)).toContain(
      "Tell me about Paul",
    );
  });
});

describe("POST /agent (A2A JSON-RPC 2.0)", () => {
  it("message/send returns a completed Task", async () => {
    const res = await messageSend("Tell me about Paul", "rpc-state");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe("rpc-state");
    expect(body.result.status.state).toBe("completed");
  });

  it("the completed Task carries a text part mentioning a resume fact", async () => {
    const res = await messageSend("Tell me about Paul");
    const body = await res.json();
    const parts = body.result.status.message.parts as {
      kind: string;
      text?: string;
    }[];
    const text = parts
      .filter((p) => p.kind === "text")
      .map((p) => p.text)
      .join(" ");
    expect(text).toContain("Paul Gebheim");
  });

  it("returns -32603 when the model call throws", async () => {
    (env as unknown as Record<string, unknown>).AI = {
      run: async () => {
        throw new Error("AI unavailable");
      },
    };
    const res = await messageSend("hello", "rpc-err");
    const body = await res.json();
    expect(body.error.code).toBe(-32603);
    expect(body.id).toBe("rpc-err");
  });

  it("returns -32601 for an unknown method", async () => {
    const res = await postAgent(
      JSON.stringify({ jsonrpc: "2.0", id: "e1", method: "tasks/get", params: {} }),
    );
    const body = await res.json();
    expect(body.error.code).toBe(-32601);
  });

  it("returns -32700 for malformed JSON", async () => {
    const res = await postAgent("{ not json");
    const body = await res.json();
    expect(body.error.code).toBe(-32700);
    expect(body.id).toBeNull();
  });

  it("returns -32600 for a malformed envelope", async () => {
    const res = await postAgent(JSON.stringify({ jsonrpc: "2.0", id: "e3" }));
    const body = await res.json();
    expect(body.error.code).toBe(-32600);
  });

  it("a message that invokes contact_paul lands one Inbox row", async () => {
    const res = await messageSend("RUN_CONTACT_PAUL please");
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    const inbox = await fetchInbox();
    const { contacts } = (await inbox.json()) as { contacts: ContactRow[] };
    const rows = contacts.filter((c) => c.contact === "ada@example.com");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Ada Lovelace",
      message: "Let us collaborate",
    });
  });

  // Deploy-verified bug: the tool loop forwarded the model's tool_calls
  // verbatim ({name, arguments}), but Workers AI validates requests against
  // the OpenAI chat schema — tool_calls need id/type/function, and tool
  // results need tool_call_id. The AI mock accepts any shape, so only this
  // pin catches the regression (production returned -32603 / AiError 8007).
  it("sends the tool-loop follow-up in OpenAI tool_calls shape", async () => {
    await messageSend("RUN_CONTACT_PAUL please");
    expect(mockAI.calls.length).toBe(2);
    const messages = mockAI.calls[1].payload.messages as Record<
      string,
      unknown
    >[];
    const assistant = messages.find(
      (m) => m.role === "assistant" && Array.isArray(m.tool_calls),
    ) as { tool_calls: Record<string, unknown>[] };
    expect(assistant).toBeDefined();
    const call = assistant.tool_calls[0];
    expect(call.id).toEqual(expect.any(String));
    expect(call.type).toBe("function");
    const fn = call.function as { name: string; arguments: unknown };
    expect(fn.name).toBe("contact_paul");
    expect(typeof fn.arguments).toBe("string"); // JSON-encoded
    const toolMsg = messages.find((m) => m.role === "tool") as {
      tool_call_id?: string;
    };
    expect(toolMsg.tool_call_id).toBe(call.id);
  });
});

describe("GET /agent/inbox", () => {
  it("rejects a missing Authorization header with 401", async () => {
    const res = await fetchInboxWithHeaders();
    expect(res.status).toBe(401);
  });

  it("rejects wrong tokens with 401 and an identical body regardless of token length", async () => {
    const token = inboxToken();
    expect(token, "env.INBOX_TOKEN must be configured").toBeDefined();
    const sameLength = await fetchInboxWithHeaders({
      Authorization: `Bearer ${"x".repeat(token.length)}`,
    });
    const shorter = await fetchInboxWithHeaders({
      Authorization: "Bearer nope",
    });
    expect(sameLength.status).toBe(401);
    expect(shorter.status).toBe(401);
    expect(await sameLength.text()).toBe(await shorter.text());
  });

  it("rejects with 401 when INBOX_TOKEN is unset, even with no Authorization header", async () => {
    const envRecord = env as unknown as Record<string, unknown>;
    const saved = envRecord.INBOX_TOKEN;
    try {
      delete envRecord.INBOX_TOKEN;
      const res = await fetchInboxWithHeaders();
      expect(res.status).toBe(401);
    } finally {
      envRecord.INBOX_TOKEN = saved;
    }
  });

  it("accepts the bearer token and returns a contacts array", async () => {
    const res = await fetchInbox();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.contacts)).toBe(true);
  });

  it("pages with ?after=<rowid>, newest first", async () => {
    const { tools } = await importAgent();
    const keys = ["page-1", "page-2", "page-3"];
    for (const [i, key] of keys.entries()) {
      await tools.contact_paul.execute(
        {
          name: `N${i}`,
          contact: `n${i}@example.com`,
          message: "m",
          idempotencyKey: key,
        },
        { env },
      );
    }
    const all = (await (await fetchInbox()).json()) as {
      contacts: ContactRow[];
    };
    expect(all.contacts).toHaveLength(3);
    const rowids = all.contacts.map((c) => c.rowid);
    expect(rowids).toEqual([...rowids].sort((a, b) => b - a));
    const middle = rowids[1];
    const page = (await (await fetchInbox(`?after=${middle}`)).json()) as {
      contacts: ContactRow[];
    };
    expect(page.contacts.map((c) => c.rowid)).toEqual(
      rowids.filter((r) => r > middle),
    );
  });

  it("treats a malformed ?after as 0", async () => {
    const { tools } = await importAgent();
    for (const key of ["mal-1", "mal-2"]) {
      await tools.contact_paul.execute(
        {
          name: key,
          contact: `${key}@example.com`,
          message: "m",
          idempotencyKey: key,
        },
        { env },
      );
    }
    const malformed = (await (await fetchInbox("?after=abc")).json()) as {
      contacts: ContactRow[];
    };
    const zero = (await (await fetchInbox("?after=0")).json()) as {
      contacts: ContactRow[];
    };
    expect(malformed.contacts).toEqual(zero.contacts);
  });
});

describe("GET /api/chat (WebSocket)", () => {
  it("upgrades and assigns a flue_session cookie", async () => {
    const res = await upgradeChat();
    expect(res.status).toBe(101);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("flue_session=");
    expect(cookie).toContain("Secure");
    const ws = res.webSocket!;
    ws.accept();
    ws.close();
  });

  it("answers a chat message over the socket", async () => {
    const res = await upgradeChat();
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    const incoming = collect(ws);
    ws.accept();
    ws.send(JSON.stringify({ type: "message", text: "hello paul" }));
    const reply = await incoming.waitFor((m) => m.includes("MOCK_REPLY"));
    expect(reply).toContain("MOCK_REPLY");
    ws.close();
  });

  it("replays history when reconnecting with the same session cookie", async () => {
    const first = await upgradeChat();
    expect(first.status).toBe(101);
    const cookie = /flue_session=[^;]+/.exec(
      first.headers.get("set-cookie") ?? "",
    )?.[0];
    expect(cookie).toBeDefined();
    const ws1 = first.webSocket!;
    const firstIncoming = collect(ws1);
    ws1.accept();
    ws1.send(JSON.stringify({ type: "message", text: "hello paul" }));
    await firstIncoming.waitFor((m) => m.includes("MOCK_REPLY"));
    ws1.close();

    const second = await upgradeChat({ Cookie: cookie! });
    expect(second.status).toBe(101);
    const ws2 = second.webSocket!;
    const replay = collect(ws2);
    ws2.accept();
    const frame = await replay.waitFor((m) => m.includes("hello paul"));
    expect(frame).toContain("hello paul");
    ws2.close();
  });

  it("ignores a malformed flue_session cookie and issues a fresh session", async () => {
    const res = await upgradeChat({ Cookie: "flue_session=not-a-uuid" });
    expect(res.status).toBe(101);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(
      /flue_session=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
    const ws = res.webSocket!;
    ws.accept();
    ws.close();
  });

  it("rejects a plain HTTP GET with a 4xx status, not an exception", async () => {
    const res = await SELF.fetch("https://gebheim.com/api/chat");
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
