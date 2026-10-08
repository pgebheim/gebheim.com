# infra/ — terraform deploy for gebheim-com

Terraform is the deploy truth for the Cloudflare Worker. `wrangler.toml` stays
the dev/test description (wrangler dev, vitest/miniflare); `infra/` is what
ships. `tests/terraform-config.test.ts` pins the two in agreement
(compatibility date/flags, Durable Object classes, cron), so they cannot drift
silently — change both files together.

Deploy is human-gated (issue #15): agents write and validate this config, a
human runs `apply`.

## Prerequisites

- terraform >= 1.9
- bun (for the bundle build)
- A scoped Cloudflare API token with Account → Workers Scripts: Edit on the
  target account. The provider reads it from `CLOUDFLARE_API_TOKEN`; never put
  the token in HCL or a tfvars file that gets committed.

## Apply

```sh
bun install
bun run build        # wrangler deploy --dry-run --outdir dist → dist/worker.js
export CLOUDFLARE_API_TOKEN=...   # scoped token, see above
export TF_VAR_account_id=...      # 32-hex account ID
export TF_VAR_inbox_token=...     # inbox bearer token (sensitive variable)
terraform -chdir=infra init
terraform -chdir=infra plan
terraform -chdir=infra apply
```

`bun run build` must run before `validate`/`plan`/`apply`: the script resource
reads `dist/worker.js` via `content_file`/`content_sha256`, and terraform
evaluates `filesha256` eagerly.

## What it manages

- `cloudflare_workers_script.gebheim_com` — the Worker: built bundle from
  `dist/`, static assets from `../public`, bindings for ASSETS, AI, the
  FlueAgent and Inbox Durable Objects (with the v1 `new_sqlite_classes`
  migration), and the `INBOX_TOKEN` secret (`secret_text` binding fed by the
  sensitive `inbox_token` variable).
- `cloudflare_workers_cron_trigger.weekly_digest` — `0 6 * * 1`.

## State

Backend is `local`: state lands in `infra/terraform.tfstate`, which is
gitignored. The state file contains the PLAINTEXT INBOX_TOKEN — the
`secret_text` binding hides it from CLI output, not from state. Do not copy,
share, or back up the state file outside this machine. Single-operator
applies work as-is. When more than one machine needs to apply, migrate to a
Cloudflare R2 bucket via the S3-compatible backend (which supports encryption)
— replace the `backend "local"` block in `versions.tf` and re-init
with `-migrate-state`.
