# Issue #8: serve the Worker on the apex domain. The gebheim.com zone already
# exists and DNS sits on Cloudflare nameservers, so attaching the custom domain
# is the whole cutover — the provider creates the edge DNS record itself, and
# it takes precedence over the existing Namecheap URL-forward record.
resource "cloudflare_workers_custom_domain" "apex" {
  account_id  = var.account_id
  zone_id     = var.zone_id
  hostname    = "gebheim.com"
  service  = cloudflare_workers_script.gebheim_com.script_name
}
