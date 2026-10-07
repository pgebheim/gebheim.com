import { describe, test, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = (p: string) => join(root, "public", p);
const readIndex = () => readFileSync(pub("index.html"), "utf8");
// Missing chat.js reads as "" so pins fail on assertions, not on ENOENT.
const readChat = () =>
  existsSync(pub("chat.js")) ? readFileSync(pub("chat.js"), "utf8") : "";
const readAgent = () => readFileSync(join(root, "src", "agent.ts"), "utf8");

const GITHUB_PROFILE = "https://github.com/pgebheim";
const LINKEDIN_PROFILE = "https://www.linkedin.com/in/pgebheim/";

// Contract pinned from src/worker.ts handleChat + src/agent.ts onMessage:
// client sends {"type":"message","text":...} over a same-origin WS at
// /api/chat; the server replies {"type":"reply","text":...} and replays
// history on connect as {"type":"history","role":...,"text":...}.
describe("server frame contract (src/agent.ts)", () => {
  test("server accepts {\"type\":\"message\",\"text\"} frames", () => {
    const agent = readAgent();
    expect(agent).toContain('parsed?.type !== "message"');
    expect(agent).toContain('typeof parsed.text !== "string"');
  });

  test("server replies with {\"type\":\"reply\",\"text\"}", () => {
    expect(readAgent()).toContain('type: "reply"');
  });

  test("server replays history as {\"type\":\"history\",\"role\",\"text\"}", () => {
    expect(readAgent()).toContain('type: "history"');
  });
});

describe("chat widget in public/index.html", () => {
  test("includes the widget via a script tag loading chat.js", () => {
    expect(readIndex()).toMatch(
      /<script[^>]+\bsrc=["'][^"']*chat\.js["'][^>]*>/i,
    );
  });

  test("carries a <noscript> path to the contact/colophon", () => {
    expect(readIndex()).toMatch(
      /<noscript>[\s\S]*?(\/colophon\.html|github\.com\/pgebheim|linkedin\.com\/in\/pgebheim)[\s\S]*?<\/noscript>/i,
    );
  });

  test("exposes no mailto:, tel:, or email in the markup", () => {
    const html = readIndex();
    expect(html).not.toMatch(/mailto:/i);
    expect(html).not.toMatch(/tel:/i);
    expect(html).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });
});

describe("public/chat.js", () => {
  test("exists as a standalone script", () => {
    expect(existsSync(pub("chat.js"))).toBe(true);
  });

  test("parses as JavaScript (node --check, module syntax)", () => {
    const chat = readChat();
    expect(chat.trim().length).toBeGreaterThan(0);
    expect(() =>
      execFileSync(process.execPath, ["--check", "--input-type=module"], {
        input: chat,
      }),
    ).not.toThrow();
  });

  test("connects a WebSocket to the same-origin /api/chat endpoint", () => {
    const chat = readChat();
    expect(chat).toContain("WebSocket");
    expect(chat).toContain("/api/chat");
  });

  test("derives the socket URL from window.location (same-origin)", () => {
    expect(readChat()).toMatch(/\blocation\./);
  });

  test("pins no hard-coded cross-origin ws(s):// API host", () => {
    expect(readChat()).not.toMatch(/wss?:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+/i);
  });

  test("sends frames shaped {\"type\":\"message\",\"text\":...}", () => {
    const chat = readChat();
    expect(chat).toMatch(/\bsend\s*\(/);
    expect(chat).toMatch(/["']message["']/);
    expect(chat).toMatch(/["']text["']/);
  });

  test("handles server {\"type\":\"reply\"} frames", () => {
    expect(readChat()).toMatch(/["']reply["']/);
  });

  test("handles server {\"type\":\"history\"} replay frames", () => {
    expect(readChat()).toMatch(/["']history["']/);
  });

  test("reads or creates the flue_session cookie", () => {
    const chat = readChat();
    expect(chat).toContain("flue_session");
    expect(chat).toContain("document.cookie");
  });

  test("fallback renders GitHub and LinkedIn profile links", () => {
    const chat = readChat();
    expect(chat).toContain(GITHUB_PROFILE);
    expect(chat).toContain(LINKEDIN_PROFILE);
  });

  test("fallback disables the input when the socket fails", () => {
    const chat = readChat();
    expect(chat).toMatch(/onerror|onclose|addEventListener\(\s*["'](error|close)["']/);
    expect(chat).toMatch(/\.disabled\s*=\s*true/);
  });

  test("keeps the form disabled until the socket open event", () => {
    const chat = readChat();
    expect(chat).toMatch(/addEventListener\(\s*["']open["']/);
    expect(chat).toMatch(/input\.disabled\s*=\s*true/);
    expect(chat).toMatch(/send\.disabled\s*=\s*true/);
  });

  test("gates submit on readyState OPEN and routes send failures to fail()", () => {
    const chat = readChat();
    expect(chat).toMatch(/readyState\s*!==\s*WebSocket\.OPEN/);
    expect(chat).toMatch(/catch\s*\{/);
  });

  test("exposes no mailto:, tel:, or email", () => {
    const chat = readChat();
    expect(chat).not.toMatch(/mailto:/i);
    expect(chat).not.toMatch(/tel:/i);
    expect(chat).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });
});
