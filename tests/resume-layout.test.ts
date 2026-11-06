import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const register = readFileSync(new URL("../public/agents.html", import.meta.url), "utf8");

describe("resume orientation and controls", () => {
  test("jump links lead to resume sections and secondary chat", () => {
    expect(html).toMatch(/<nav[^>]*aria-label="On this page"/);
    for (const id of ["experience", "projects", "talks", "chat"]) {
      expect(html).toContain(`href="#${id}"`);
      expect(html).toContain(`<section id="${id}">`);
    }
    expect(html).toMatch(/<nav[^>]*class="[^"]*no-print/);
  });

  test("Page has an explanation, live status, and native radio selection", () => {
    expect(html).toContain("Paul’s AI assistant");
    expect(html).toMatch(/id="chat-status"[^>]*role="status"/);
    expect(html).toMatch(/<fieldset[^>]*id="persona-picker"/);
    expect(html).not.toContain('role="radiogroup"');
    expect(html.match(/type="radio" name="persona"/g)).toHaveLength(4);
    expect(html).toContain("<legend>Reply style</legend>");
  });

  test("the footer exposes the canonical agent guestbook", () => {
    const footer = html.slice(html.indexOf("<footer>"));
    expect(footer).toContain('href="/agents"');
    expect(footer).toContain("Agent guestbook");
  });

  test("screen styles support narrow controls, code and long signatures", () => {
    expect(html).toMatch(/\.chat-form input[^}]*min-width:\s*0/);
    expect(html).toMatch(/min-height:\s*44px/);
    expect(register).toMatch(/#agent-list li[^}]*flex-wrap:\s*wrap/);
    expect(register).toMatch(/overflow-wrap:\s*anywhere/);
    expect(register).toMatch(/pre\s*\{[^}]*overflow-x:\s*auto/);
  });
});
