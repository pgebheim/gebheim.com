import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const pub = (p: string) => join(root, "public", p);
const read = (p: string) => readFileSync(pub(p), "utf8");

describe("public/llms.txt", () => {
  const path = "llms.txt";

  test("exists and is non-empty", () => {
    expect(existsSync(pub(path))).toBe(true);
    expect(read(path).trim().length).toBeGreaterThan(0);
  });

  test("opens with a single H1", () => {
    const text = read(path).replace(/\r\n/g, "\n");
    const first = text.split("\n").find((l) => l.trim() !== "");
    expect(first).toMatch(/^# (?!#)/);
    expect(text.match(/^# (?!#)/gm)?.length).toBe(1);
  });

  test("follows the H1 with a blockquote summary", () => {
    const lines = read(path)
      .replace(/\r\n/g, "\n")
      .split("\n")
      .filter((l) => l.trim() !== "");
    const h1 = lines.findIndex((l) => /^# (?!#)/.test(l));
    expect(lines[h1 + 1]).toMatch(/^> /);
  });

  test("has at least one H2 link section", () => {
    expect(read(path)).toMatch(/^## (?!#)/m);
  });

  test("links only to https URLs and includes the canonical site", () => {
    const urls = [...read(path).matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url).toMatch(/^https:\/\//);
    expect(urls.some((u) => u.startsWith("https://gebheim.com"))).toBe(true);
  });
});

describe("JSON-LD in public/index.html", () => {
  const blocks = () =>
    [...read("index.html").matchAll(
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    )].map((m) => m[1].trim());

  test("embeds at least one JSON-LD script", () => {
    expect(blocks().length).toBeGreaterThanOrEqual(1);
  });

  test("every JSON-LD block parses as JSON", () => {
    const found = blocks();
    expect(found.length).toBeGreaterThanOrEqual(1);
    for (const b of found) expect(() => JSON.parse(b)).not.toThrow();
  });

  test("declares a schema.org Person at the canonical URL", () => {
    const docs = blocks().map((b) => JSON.parse(b));
    const person = docs.find(
      (d) =>
        String(d["@context"]).includes("schema.org") &&
        d["@type"] === "Person",
    );
    expect(person).toBeDefined();
    expect(person.url).toBe("https://gebheim.com");
    expect(typeof person.name).toBe("string");
  });
});

describe("public/resume.json", () => {
  const path = "resume.json";
  const json = () => JSON.parse(read(path));

  test("exists and parses as JSON", () => {
    expect(existsSync(pub(path))).toBe(true);
    expect(() => json()).not.toThrow();
  });

  test("has basics.name matching the site owner", () => {
    expect(json().basics?.name).toBe("Paul Gebheim");
  });

  test("exposes no email or phone anywhere", () => {
    const resume = json();
    const keys: string[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") {
        for (const [k, val] of Object.entries(v)) {
          keys.push(k);
          walk(val);
        }
      }
    };
    walk(resume);
    expect(keys.filter((k) => /^(email|phone)$/i.test(k))).toEqual([]);
    expect(JSON.stringify(resume)).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });

  test("lists work history with schema-required fields", () => {
    const work = json().work;
    expect(Array.isArray(work)).toBe(true);
    expect(work.length).toBeGreaterThan(0);
    for (const job of work) {
      expect(typeof job.name).toBe("string");
      expect(job.startDate).toMatch(/^\d{4}(-\d{2})?(-\d{2})?$/);
    }
  });

  test("work history is transcribed from the resume page", () => {
    const names = json().work.map((j: { name: string }) => j.name);
    expect(names).toContain("Sei Labs");
    expect(names).toContain("Polygon Technology");
  });

  test("lists education", () => {
    const education = json().education;
    expect(Array.isArray(education)).toBe(true);
    expect(education.length).toBeGreaterThan(0);
  });
});

describe("public/.well-known/agent.json", () => {
  const path = ".well-known/agent.json";
  const json = () => JSON.parse(read(path));

  test("exists and parses as JSON", () => {
    expect(existsSync(pub(path))).toBe(true);
    expect(() => json()).not.toThrow();
  });

  test("points at the canonical agent endpoint", () => {
    expect(json().url).toBe("https://gebheim.com/agent");
  });

  test("carries the A2A card identity fields", () => {
    const card = json();
    expect(typeof card.name).toBe("string");
    expect(typeof card.description).toBe("string");
    expect(typeof card.version).toBe("string");
  });
});

describe("public/colophon.html", () => {
  const path = "colophon.html";

  test("exists and is an HTML document", () => {
    expect(existsSync(pub(path))).toBe(true);
    const html = read(path).toLowerCase();
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
  });

  test("names the stack and AI tools that built the site", () => {
    const html = read(path);
    const lower = html.toLowerCase();
    for (const tool of ["hand-written html", "cloudflare workers", "bun", "claude"]) {
      expect(lower).toContain(tool);
    }
    expect(lower).toMatch(/\bpi\b/);
    expect(lower).toMatch(/\brig\b/);
  });
});
