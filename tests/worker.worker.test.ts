import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";
import indexHtml from "../public/index.html?raw";

describe("worker static file serving", () => {
  it("GET / returns 200 with the public/index.html bytes", async () => {
    const res = await SELF.fetch("https://gebheim.com/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(indexHtml);
  });

  it("GET /llms.txt returns 200", async () => {
    const res = await SELF.fetch("https://gebheim.com/llms.txt");
    expect(res.status).toBe(200);
  });

  it("GET /.well-known/agent.json returns 200 as application/json", async () => {
    const res = await SELF.fetch("https://gebheim.com/.well-known/agent.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("GET /nope returns 404", async () => {
    const res = await SELF.fetch("https://gebheim.com/nope");
    expect(res.status).toBe(404);
  });

  it("HEAD / returns 200", async () => {
    const res = await SELF.fetch("https://gebheim.com/", { method: "HEAD" });
    expect(res.status).toBe(200);
  });
});
