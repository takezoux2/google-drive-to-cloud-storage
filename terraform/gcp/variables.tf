variable "environment" {
  description = "Environment name (e.g. \"dev\", \"prd\"). Must match the currently selected terraform workspace (`terraform workspace show`)."
  type        = string

  validation {
    condition     = var.environment == terraform.workspace
    error_message = "var.environment (\"${var.environment}\") must match the current terraform workspace (\"${terraform.workspace}\"). Run `terraform workspace select ${var.environment}` first, or fix the tfvars file."
  }
}

variable "project_id" {
  description = "GCP project ID to deploy the Workload Identity Federation resources into."
  type        = string
}

variable "github_repository" {
  description = "GitHub repository allowed to assume the service account, in \"owner/repo\" form."
  type        = string
  default     = "takezoux2/google-drive-to-cloud-storage"
}

variable "gcs_bucket_name" {
  description = "Name of the GCS bucket the GitHub Actions service account is allowed to write to."
  type        = string
}

variable "pool_id" {
  description = "ID of the Workload Identity Pool."
  type        = string
  default     = "github-actions-pool"
}

variable "provider_id" {
  description = "ID of the Workload Identity Pool Provider."
  type        = string
  default     = "github-actions-provider"
}

variable "service_account_id" {
  description = "Account ID (local part of the email) of the service account used by GitHub Actions."
  type        = string
  default     = "github-actions-sync"
}

variable "impersonator_email" {
  description = "Google account email allowed to impersonate the GitHub Actions service account for local ADC-based testing."
  type        = string
}
