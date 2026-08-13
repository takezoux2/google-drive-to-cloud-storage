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
