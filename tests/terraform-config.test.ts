import { describe, test, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";

interface WranglerConfig {
  name: string;
  compatibility_date: string;
  compatibility_flags?: string[];
  assets: { directory: string; binding: string };
  ai: { binding: string };
  durable_objects: { bindings: { name: string; class_name: string }[] };
  migrations: { tag: string; new_sqlite_classes?: string[] }[];
  triggers?: { crons?: string[] };
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = parse(
  readFileSync(join(root, "wrangler.toml"), "utf8"),
) as unknown as WranglerConfig;

// Issue #15 (terraform deploy config): the HCL under infra/ is a second
// deploy description next to wrangler.toml. No HCL parser is available, so
// every pin below is a whitespace-tolerant string/regex assertion — the
// same spirit as tests/wrangler-config.test.ts. Nothing here shells out to
// terraform; the tests run in any environment with bun.
// Review note (#15 GREEN): pins target provider v5 — assets is a nested attribute (assets = {...}); INBOX_TOKEN is a secret_text binding on the script (v4's cloudflare_workers_secret resource is removed in v5).
const infraDir = join(root, "infra");
const tfPaths = existsSync(infraDir)
  ? readdirSync(infraDir)
      .filter((f) => f.endsWith(".tf"))
      .sort()
      .map((f) => join(infraDir, f))
  : [];
const hcl = tfPaths.map((p) => readFileSync(p, "utf8")).join("\n");

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("infra/ terraform layout", () => {
  test("infra/ directory exists", () => {
    expect(existsSync(infraDir)).toBe(true);
  });

  test("contains at least one .tf file", () => {
    expect(tfPaths.length).toBeGreaterThan(0);
  });

  test("pins the cloudflare provider source", () => {
    expect(hcl).toMatch(/source\s*=\s*"cloudflare\/cloudflare"/);
  });

  test("requires the cloudflare provider at ~> 5.27", () => {
    expect(hcl).toMatch(/version\s*=\s*"~>\s*5\.27"/);
  });

  test("declares the R2 (S3-compatible) backend for shared state", () => {
    expect(hcl).toMatch(/backend\s+"s3"/);
    expect(hcl).toMatch(/bucket\s*=\s*"gebheim-com-tf"/);
    expect(hcl).toMatch(/r2\.cloudflarestorage\.com/);
    // R2 is not AWS: region/credential/account probing must be skipped.
    expect(hcl).toMatch(/skip_region_validation\s*=\s*true/);
    expect(hcl).toMatch(/skip_credentials_validation\s*=\s*true/);
    expect(hcl).toMatch(/skip_requesting_account_id\s*=\s*true/);
  });
});

describe("cloudflare_workers_script resource", () => {
  test("declares a workers script resource", () => {
    expect(hcl).toMatch(/resource\s+"cloudflare_workers_script"\s+"[a-z0-9_]+"/);
  });

  test("script_name matches wrangler.toml's name", () => {
    expect(hcl).toMatch(
      new RegExp(`script_name\\s*=\\s*"${escapeRe(wrangler.name)}"`),
    );
  });

  test("serves assets from a directory covering public/", () => {
    expect(hcl).toMatch(/assets\s*=\s*\{/);
    expect(hcl).toMatch(/directory\s*=\s*"[^"]*public/);
  });

  test.each(["FlueAgent", "Inbox"])(
    "binds the %s Durable Object by class name",
    (className) => {
      expect(hcl).toMatch(new RegExp(`class_name\\s*=\\s*"${className}"`));
    },
  );

  test.each(["FlueAgent", "Inbox"])(
    "migrates %s via new_sqlite_classes",
    (className) => {
      expect(hcl).toMatch(
        new RegExp(`new_sqlite_classes\\s*=\\s*\\[[^\\]]*"${className}"[^\\]]*\\]`),
      );
    },
  );

  test("migration new_tag matches wrangler.toml's [[migrations]] tag", () => {
    for (const migration of wrangler.migrations) {
      if (migration.new_sqlite_classes?.length) {
        expect(hcl).toMatch(
          new RegExp(`new_tag\\s*=\\s*"${escapeRe(migration.tag)}"`),
        );
      }
    }
  });

  test("binds Workers AI under wrangler.toml's [ai].binding name", () => {
    expect(hcl).toMatch(/type\s*=\s*"ai"/);
    expect(hcl).toMatch(
      new RegExp(`name\\s*=\\s*"${escapeRe(wrangler.ai.binding)}"`),
    );
  });

  test("binds ASSETS under wrangler.toml's [assets].binding name", () => {
    expect(hcl).toMatch(/type\s*=\s*"assets"/);
    expect(hcl).toMatch(
      new RegExp(`name\\s*=\\s*"${escapeRe(wrangler.assets.binding)}"`),
    );
  });
});

// The core pin: terraform and wrangler.toml describe the same deployment and
// must not drift. Every expectation derives its value from wrangler.toml.
describe("drift guard: terraform agrees with wrangler.toml", () => {
  test("compatibility_date matches wrangler.toml", () => {
    expect(hcl).toMatch(
      new RegExp(
        `compatibility_date\\s*=\\s*"${escapeRe(wrangler.compatibility_date)}"`,
      ),
    );
  });

  test("compatibility_flags match wrangler.toml", () => {
    for (const flag of wrangler.compatibility_flags ?? []) {
      expect(hcl).toMatch(
        new RegExp(
          `compatibility_flags\\s*=\\s*\\[[^\\]]*"${escapeRe(flag)}"[^\\]]*\\]`,
        ),
      );
    }
  });

  test("Durable Object class names match wrangler.toml", () => {
    for (const binding of wrangler.durable_objects.bindings) {
      expect(hcl).toMatch(
        new RegExp(`class_name\\s*=\\s*"${escapeRe(binding.class_name)}"`),
      );
    }
  });

  test("cron expression matches wrangler.toml", () => {
    for (const cron of wrangler.triggers?.crons ?? []) {
      expect(hcl).toMatch(new RegExp(`"${escapeRe(cron)}"`));
    }
  });
});

describe("cron trigger", () => {
  test("manages the cron trigger as a terraform resource", () => {
    expect(hcl).toMatch(/resource\s+"cloudflare_workers_cron_trigger"/);
  });

  test("schedules exactly 0 6 * * 1 and nothing else", () => {
    expect(hcl).toMatch(/crons\s*=\s*\[\s*"0 6 \* \* 1"\s*\]/);
  });
});

// Issue #8: the Worker serves the apex via a custom domain. The zone already
// exists and DNS sits on Cloudflare nameservers, so terraform only attaches
// the hostname to the script — the provider creates the edge record itself.
describe("custom domain (#8)", () => {
  test("manages the custom domain as a terraform resource", () => {
    expect(hcl).toMatch(/resource\s+"cloudflare_workers_custom_domain"/);
  });

  test("attaches exactly gebheim.com to the workers script", () => {
    expect(hcl).toMatch(/hostname\s*=\s*"gebheim\.com"/);
    // service references the script resource (terraform-correct); the
    // script's own script_name pin already ties it to wrangler.toml.
    expect(hcl).toMatch(
      /service\s*=\s*cloudflare_workers_script\.[a-z0-9_]+\.(script_name|name)/,
    );
  });

  test("references the zone through a variable with the real zone id as default", () => {
    expect(hcl).toMatch(/variable\s+"zone_id"/);
    expect(hcl).toMatch(/default\s*=\s*"[0-9a-f]{32}"/);
    expect(hcl).toMatch(/zone_id\s*=\s*var\.zone_id/);
  });
});

describe("secrets", () => {
  test("declares the inbox token as a sensitive variable", () => {
    expect(hcl).toMatch(
      /variable\s+"[^"]*inbox_token[^"]*"\s*\{[^}]*sensitive\s*=\s*true[^}]*\}/is,
    );
  });

  test("stores INBOX_TOKEN as a workers secret from the variable", () => {
    expect(hcl).toMatch(/name\s*=\s*"INBOX_TOKEN"/);
    expect(hcl).toMatch(/type\s*=\s*"secret_text"/);
    expect(hcl).toMatch(/text\s*=\s*var\.[a-z0-9_]*inbox_token/i);
  });

  test("never commits the literal inbox token", () => {
    // vitest.config.ts binds "test-inbox-token" in miniflare; the production
    // value must only ever arrive via `terraform apply -var`, never a file.
    expect(hcl).not.toContain("test-inbox-token");
  });

  test("references account_id through a variable, never a literal hex id", () => {
    expect(hcl).toMatch(/account_id\s*=\s*var\./);
    expect(hcl).not.toMatch(/account_id\s*=\s*"[0-9a-f]{32}"/i);
  });

  test("never hardcodes a Cloudflare API token value", () => {
    expect(hcl).not.toMatch(/api_token\s*=\s*"/);
  });
});

describe("package.json build script", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };

  test("defines a build script", () => {
    expect(typeof pkg.scripts?.build).toBe("string");
  });

  test("build script produces the dist/ deploy bundle", () => {
    expect(pkg.scripts?.build ?? "").toMatch(/dist/);
  });
});
