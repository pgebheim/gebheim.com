# www → apex redirect. The stale www A record (Namecheap URL-forward) was
# deleted out-of-band; the proxied CNAME puts www on the Cloudflare edge so
# the redirect rule has traffic to match, and the zone ruleset issues the 301.
resource "cloudflare_dns_record" "www" {
  zone_id = var.zone_id
  name    = "www"
  type    = "CNAME"
  content = "gebheim.com"
  proxied = true
  ttl     = 1 # auto; required when proxied
}

resource "cloudflare_ruleset" "www_redirect" {
  zone_id = var.zone_id
  name    = "www to apex redirect"
  kind    = "zone"
  phase   = "http_request_dynamic_redirect"

  rules = [{
    expression = "http.host eq 'www.gebheim.com'"
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
