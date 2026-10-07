import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";

interface WranglerConfig {
  main: string;
  name: string;
  compatibility_date: string;
  assets: { directory: string };
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = parse(
  readFileSync(join(root, "wrangler.toml"), "utf8"),
) as unknown as WranglerConfig;

describe("wrangler.toml", () => {
  test("sets main to the worker entrypoint", () => {
    expect(config.main).toBe("src/worker.ts");
  });

  test("serves static assets from ./public", () => {
    expect(config.assets?.directory).toBe("./public");
  });

  test("pins a compatibility_date", () => {
    expect(typeof config.compatibility_date).toBe("string");
  });

  test("names the worker", () => {
    expect(typeof config.name).toBe("string");
    expect(config.name.length).toBeGreaterThan(0);
  });

  test("declares no email-send binding", () => {
    const raw = readFileSync(join(root, "wrangler.toml"), "utf8");
    expect(raw.toLowerCase()).not.toContain("send_email");
    expect(Object.keys(config)).not.toContain("send_email");
    expect(JSON.stringify(config)).not.toMatch(
      /mailchannels|sendgrid|postmark|resend/i,
    );
  });
});
