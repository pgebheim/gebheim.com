terraform {
  required_version = ">= 1.9.0"

  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
      # content_file/secret_text script bindings postdate 5.11; the lock pins 5.27.0.
      version = "~> 5.27"
    }
  }

  # Local backend by default: state lives in infra/terraform.tfstate (gitignored).
  # Upgrade path for shared state is a Cloudflare R2 bucket via the S3-compatible
  # backend — swap this block when more than one machine applies.
  backend "local" {}
}
