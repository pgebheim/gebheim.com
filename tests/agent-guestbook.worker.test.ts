import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { inboxStub } from "./helpers.workers";

// Contract for the agent guestbook: POST /api/agents registers a visiting
// agent (idempotent by name, rate-limited per IP), GET /api/agents lists the
// register, and /agents renders it for humans.

function postAgents(body: unknown, ip = "203.0.113.1"): Promise<Response> {
  return SELF.fetch("https://gebheim.com/api/agents", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(async () => {
  await inboxStub().kvSet("guestbook:agents", "[]");
  for (const key of ["guestbook:ip:203.0.113.1", "guestbook:ip:203.0.113.2"]) {
    await inboxStub().kvSet(key, "");
  }
});

describe("agent guestbook", () => {
  it("starts empty and accepts a registration", async () => {
    const empty = await SELF.fetch("https://gebheim.com/api/agents");
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ agents: [] });

    const res = await postAgents({ name: "TestBot", url: "https://test.bot/" });
    expect(res.status).toBe(201);

    const list = await (await SELF.fetch("https://gebheim.com/api/agents")).json();
    expect(list.agents).toHaveLength(1);
    expect(list.agents[0].name).toBe("TestBot");
    expect(list.agents[0].url).toBe("https://test.bot/");
    expect(list.agents[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("is idempotent by name — re-registering updates instead of duplicating", async () => {
    await postAgents({ name: "TestBot" }, "203.0.113.1");
    const again = await postAgents(
      { name: "TestBot", url: "https://new.home/" },
      "203.0.113.2",
    );
    expect(again.status).toBe(200);
    const list = await (await SELF.fetch("https://gebheim.com/api/agents")).json();
    expect(list.agents).toHaveLength(1);
    expect(list.agents[0].url).toBe("https://new.home/");
  });

  it("rejects invalid input with 400", async () => {
    expect((await postAgents({ name: "" })).status).toBe(400);
    expect((await postAgents({ name: "x".repeat(81) })).status).toBe(400);
    expect((await postAgents({ name: "<script>" })).status).toBe(400);
    expect((await postAgents({ name: "Bot", url: "http://nope" })).status).toBe(400);
    expect((await postAgents("not json")).status).toBe(400);
  });

  it("rate-limits one registration per IP per hour", async () => {
    const first = await postAgents({ name: "First" }, "203.0.113.1");
    expect(first.status).toBe(201);
    const second = await postAgents({ name: "Second" }, "203.0.113.1");
    expect(second.status).toBe(429);
    expect(await second.json()).toEqual({ error: "rate_limited" });
  });

  it("serves the human-readable register page", async () => {
    const res = await SELF.fetch("https://gebheim.com/agents");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Visitor Register");
    expect(html).toContain("/api/agents");
  });
});
