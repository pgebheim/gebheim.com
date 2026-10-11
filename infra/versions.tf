terraform {
  required_version = ">= 1.9.0"

  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
      # content_file/secret_text script bindings postdate 5.11; the lock pins 5.27.0.
      version = "~> 5.27"
    }
  }

  # State lives in the R2 bucket gebheim-com-tf (S3-compatible backend).
  # Credentials come from the environment (see infra/README.md):
  #   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY — derived from the scoped
  #   "gebheim-com-terraform-state" API token (id + sha256(value)).
  backend "s3" {
    bucket = "gebheim-com-tf"
    key    = "terraform.tfstate"
    endpoints = {
      s3 = "https://16626364480ee79b98ed6d31bea37e8c.r2.cloudflarestorage.com"
    }
    region                      = "auto"
    skip_region_validation      = true
    skip_credentials_validation = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
  }
}
