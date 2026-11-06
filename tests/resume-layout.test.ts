import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const register = readFileSync(new URL("../public/agents.html", import.meta.url), "utf8");

describe("resume orientation and controls", () => {
  test("jump links lead to resume sections", () => {
    expect(html).toMatch(/<nav[^>]*aria-label="On this page"/);
    for (const id of ["experience", "projects", "talks"]) {
      expect(html).toContain(`href="#${id}"`);
      expect(html).toContain(`<section id="${id}">`);
    }
    expect(html).toMatch(/<nav[^>]*class="[^"]*no-print/);
  });

  test("the resume has no Page chat, chat navigation, or client script", () => {
    expect(html).not.toContain('href="#chat"');
    expect(html).not.toContain('id="chat"');
    expect(html).not.toContain("Chat with Page");
    expect(html).not.toContain("chat.js");
    expect(html).not.toContain(".chat-");
    expect(existsSync(new URL("../public/chat.js", import.meta.url))).toBe(false);
  });

  test("the footer exposes the canonical agent guestbook", () => {
    const footer = html.slice(html.indexOf("<footer>"));
    expect(footer).toContain('href="/agents"');
    expect(footer).toContain("Agent guestbook");
  });

  test("screen styles support navigation controls, code and long signatures", () => {
    expect(html).toMatch(/min-height:\s*44px/);
    expect(register).toMatch(/#agent-list li[^}]*flex-wrap:\s*wrap/);
    expect(register).toMatch(/overflow-wrap:\s*anywhere/);
    expect(register).toMatch(/pre\s*\{[^}]*overflow-x:\s*auto/);
  });
});
