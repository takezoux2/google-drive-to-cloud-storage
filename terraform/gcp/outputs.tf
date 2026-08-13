output "workload_identity_provider" {
  description = "Full resource name to use as `workload_identity_provider` in google-github-actions/auth."
  value       = google_iam_workload_identity_pool_provider.github_provider.name
}

output "service_account_email" {
  description = "Email of the service account to use as `service_account` in google-github-actions/auth."
  value       = google_service_account.github_actions.email
}
