locals {
  # Single source for the schedule; the provider resource below consumes it.
  # Drift guard: tests/terraform-config.test.ts pins this equal to
  # wrangler.toml [triggers].crons.
  crons = ["0 6 * * 1"]
}

resource "cloudflare_workers_cron_trigger" "weekly_digest" {
  account_id  = var.account_id
  script_name = cloudflare_workers_script.gebheim_com.script_name
  schedules   = [for cron in local.crons : { cron = cron }]
}
