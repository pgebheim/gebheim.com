import { describe, test, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// GitOps deploy workflow: terraform plan on PRs, apply on merges to main.
// No YAML parser in devDeps — whitespace-tolerant string pins, same spirit as
// tests/terraform-config.test.ts. The workflow drives terraform; these tests
// never invoke it.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wfPath = join(root, ".github", "workflows", "terraform.yml");
const wf = existsSync(wfPath) ? readFileSync(wfPath, "utf8") : "";

describe("gitops terraform workflow", () => {
  test(".github/workflows/terraform.yml exists", () => {
    expect(existsSync(wfPath)).toBe(true);
  });

  test("triggers on pull requests, pushes to main, and manual dispatch", () => {
    expect(wf).toMatch(/^\s*pull_request:/m);
    expect(wf).toMatch(/push:\s*\n\s*branches:\s*\[?["']?main["']?\]?/);
    expect(wf).toMatch(/workflow_dispatch:/);
  });

  test("serializes terraform runs with a concurrency group", () => {
    expect(wf).toMatch(/concurrency:/);
  });

  test("builds the worker bundle before any terraform step", () => {
    const buildIdx = wf.indexOf("bun run build");
    const tfIdx = wf.search(/terraform[^\n]*?(init|plan|validate)/);
    expect(buildIdx).toBeGreaterThan(-1);
    expect(tfIdx).toBeGreaterThan(-1);
    expect(buildIdx).toBeLessThan(tfIdx);
  });

  test("runs init against the configured backend (no -backend=false)", () => {
    expect(wf).toMatch(/terraform[^\n]*init/);
    expect(wf).not.toMatch(/-backend=false/);
  });

  test("applies only on pushes to main, auto-approved", () => {
    expect(wf).toMatch(/apply[^\n]*-auto-approve/);
    expect(wf).toMatch(/github\.ref\s*==\s*'refs\/heads\/main'/);
  });

  test("maps every credential from GitHub secrets into the env terraform reads", () => {
    // Terraform matches TF_VAR_ names case-sensitively and the variables are
    // declared lowercase, so the env keys must be lowercase even though the
    // GitHub secret names are uppercase.
    for (const [envKey, secret] of [
      ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_API_TOKEN"],
      ["TF_VAR_account_id", "TF_VAR_ACCOUNT_ID"],
      ["TF_VAR_inbox_token", "TF_VAR_INBOX_TOKEN"],
      ["AWS_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID"],
      ["AWS_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY"],
    ]) {
      expect(wf).toContain(`${envKey}: `);
      expect(wf).toContain(`secrets.${secret}`);
    }
  });
});
