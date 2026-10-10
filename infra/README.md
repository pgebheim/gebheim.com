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
source ~/.config/gebheim/deploy.env   # scoped tokens + backend creds (never commit)
terraform -chdir=infra init
terraform -chdir=infra plan
terraform -chdir=infra apply
```

`deploy.env` provides `CLOUDFLARE_API_TOKEN` (scoped deploy token),
`TF_VAR_account_id`, and the backend's `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` (derived from the scoped R2 state token). Set
`TF_VAR_inbox_token` separately (`openssl rand -hex 32`) — it is the inbox
bearer token, deliberately not stored in `deploy.env`.

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

Backend is the R2 bucket `gebheim-com-tf` via the S3-compatible backend
credentials from the environment, not on disk in the repo. State contains the
PLAINTEXT INBOX_TOKEN — the `secret_text` binding hides it from CLI output,
not from state. The bucket is private and the state token is scoped to R2
storage only; treat anyone with those creds as holding the inbox token.
Local `terraform.tfstate*` files remain gitignored for anyone running a local
backend override.
