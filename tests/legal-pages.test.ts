import { describe, test, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Legal pages: public/privacy/index.html and public/tos/index.html, served
// at /privacy and /tos by Static Assets' directory index handling.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = (p: string) => join(root, "public", p);

const pages: [string, string][] = [
  ["privacy", "privacy/index.html"],
  ["tos", "tos/index.html"],
];

describe("legal pages", () => {
  for (const [route, file] of pages) {
    test(`/${route} exists as a directory index page`, () => {
      expect(existsSync(pub(file))).toBe(true);
    });

    test(`/${route} renders a titled HTML document`, () => {
      const html = readFileSync(pub(file), "utf8");
      expect(html).toMatch(/<title>.+<\/title>/);
      expect(html).toMatch(/<h1>/);
    });

    test(`/${route} exposes no mailto:, tel:, or email address`, () => {
      const html = readFileSync(pub(file), "utf8");
      expect(html).not.toMatch(/mailto:/i);
      expect(html).not.toMatch(/tel:/i);
      expect(html).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    });
  }

  test("the home page footer links both pages", () => {
    const html = readFileSync(pub("index.html"), "utf8");
    expect(html).toMatch(/href=["']\/privacy["']/);
    expect(html).toMatch(/href=["']\/tos["']/);
  });

  test("the pages cross-link each other", () => {
    expect(readFileSync(pub("privacy/index.html"), "utf8")).toMatch(
      /href=["']\/tos["']/,
    );
    expect(readFileSync(pub("tos/index.html"), "utf8")).toMatch(
      /href=["']\/privacy["']/,
    );
  });
});
