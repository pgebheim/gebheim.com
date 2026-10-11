provider "cloudflare" {
  # Authenticates via the CLOUDFLARE_API_TOKEN environment variable.
  # Never set api_token in HCL — that would commit a credential.
}

resource "cloudflare_workers_script" "gebheim_com" {
  account_id  = var.account_id
  script_name = "gebheim-com"

  # Bundle built by `bun run build` (wrangler deploy --dry-run --outdir dist).
  content_file   = "${path.module}/../dist/worker.js"
  content_sha256 = filesha256("${path.module}/../dist/worker.js")
  main_module    = "worker.js"

  # Drift guard: tests/terraform-config.test.ts pins both values equal to
  # wrangler.toml. Change wrangler.toml and this file together.
  compatibility_date  = "2026-08-15"
  compatibility_flags = ["nodejs_compat"]

  assets = {
    directory = "${path.module}/../public"
  }

  bindings = [
    {
      name = "ASSETS"
      type = "assets"
    },
    {
      name = "AI"
      type = "ai"
    },
    {
      name       = "FlueAgent"
      type       = "durable_object_namespace"
      class_name = "FlueAgent"
    },
    {
      name       = "Inbox"
      type       = "durable_object_namespace"
      class_name = "Inbox"
    },
    {
      name = "INBOX_TOKEN"
      type = "secret_text"
      text = var.inbox_token
    },
  ]

  # No migrations block: the v1 tag and both SQLite classes are already
  # applied. The Workers API treats migrations as one-way and rejects an
  # update whose migrations carry an empty/old tag ("Actor migration tag
  # precondition failed"), and the v5 provider cannot send the tag on update
  # (cloudflare/terraform-provider-cloudflare#5701). Restore a migrations
  # attribute (new_tag + new_sqlite_classes) only when a NEW class or rename
  # actually needs a migration, and remove it again once applied.
  # wrangler.toml keeps its [[migrations]] as the record.
}
