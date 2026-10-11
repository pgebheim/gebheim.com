resource "cloudflare_workers_cron_trigger" "weekly_digest" {
  account_id  = var.account_id
  script_name = cloudflare_workers_script.gebheim_com.script_name
  # Drift guard: tests/terraform-config.test.ts pins this equal to
  # wrangler.toml [triggers].crons.
  schedules = [{ cron = "0 6 * * 1" }]
}
