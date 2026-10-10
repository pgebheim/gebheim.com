variable "account_id" {
  type        = string
  description = "Cloudflare account ID that owns the gebheim-com Worker."
}

variable "zone_id" {
  type        = string
  # gebheim.com zone; not a secret, stable for this site.
  default     = "3878c66893a78222f2a99354a4c5d0d2"
  description = "Zone ID for gebheim.com."
}

variable "inbox_token" {
  type        = string
  sensitive   = true
  description = "Bearer token for the inbox endpoints. Supplied at apply time via TF_VAR_inbox_token or -var; never committed."
}
