# www → apex redirect. The stale www A record (Namecheap URL-forward) was
# deleted out-of-band. www attaches to the same Worker as a second custom
# domain (a proxied CNAME to the apex does NOT route to the Worker — custom
# domains match on exact hostname; the CNAME attempt 522'd). The zone redirect
# ruleset fires before the Worker and issues the 301 to the apex.
# NOTE: the phase's pre-existing empty 'default' ruleset was terraform-imported
# and replaced by this resource (one zone ruleset per phase is the cap).
resource "cloudflare_workers_custom_domain" "www" {
  account_id = var.account_id
  zone_id    = var.zone_id
  hostname   = "www.gebheim.com"
  service    = cloudflare_workers_script.gebheim_com.script_name
}

resource "cloudflare_ruleset" "www_redirect" {
  zone_id = var.zone_id
  name    = "www to apex redirect"
  kind    = "zone"
  phase   = "http_request_dynamic_redirect"

  rules = [{
    expression = "http.host eq \"www.gebheim.com\""
    action     = "redirect"
    action_parameters = {
      from_value = {
        status_code = 301
        target_url = {
          # preserve the path so deep links survive the redirect
          expression = "concat(\"https://gebheim.com\", http.request.uri.path)"
        }
        preserve_query_string = true
      }
    }
  }]
}
