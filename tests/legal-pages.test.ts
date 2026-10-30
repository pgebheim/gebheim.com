import { describe, test, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Legal pages: public/privacy.html and public/tos.html (OAuth consent screen
// requirements). The content is the operator's own legal text — these pins
// cover existence, structure, and discoverability, not wording.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = (p: string) => join(root, "public", p);

const pages = ["privacy.html", "tos.html"];

describe("legal pages", () => {
  for (const file of pages) {
    test(`/${file} exists`, () => {
      expect(existsSync(pub(file))).toBe(true);
    });

    test(`/${file} renders a titled HTML document`, () => {
      const html = readFileSync(pub(file), "utf8");
      expect(html).toMatch(/<title>.+<\/title>/);
      expect(html).toMatch(/<h1>/);
    });

    test(`/${file} links back to the home page`, () => {
      expect(readFileSync(pub(file), "utf8")).toMatch(/href=["']\/["']/);
    });
  }

  test("the home page footer links both pages", () => {
    const html = readFileSync(pub("index.html"), "utf8");
    expect(html).toMatch(/href=["']\/privacy\.html["']/);
    expect(html).toMatch(/href=["']\/tos\.html["']/);
  });
});

describe("print resume", () => {
  const html = () => readFileSync(pub("index.html"), "utf8");

  test("a Download PDF button triggers the browser print dialog", () => {
    expect(html()).toContain("window.print()");
    expect(html()).toContain("Download PDF");
  });

  test("print styles hide the chat widget, footer, and the button itself", () => {
    const printBlock = html().slice(html().indexOf("@media print"));
    expect(printBlock).toContain("#chat { display: none; }");
    expect(printBlock).toMatch(/footer[^{]*\{[^}]*display: none/);
    expect(printBlock).toMatch(/\.no-print[^{]*\{[^}]*display: none/);
  });
});
