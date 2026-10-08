variable "account_id" {
  type        = string
  description = "Cloudflare account ID that owns the gebheim-com Worker."
}

variable "inbox_token" {
  type        = string
  sensitive   = true
  description = "Bearer token for the inbox endpoints. Supplied at apply time via TF_VAR_inbox_token or -var; never committed."
}
