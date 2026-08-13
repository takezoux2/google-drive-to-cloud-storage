# GCP Workload Identity Federation for GitHub Actions

GitHub Actions上でsync CLIを実行する際に、サービスアカウントキーを使わず
Workload Identity Federation(OIDC)でGCPに認証するためのリソースを構築する。

作成されるリソース:

- Workload Identity Pool / Provider (issuer: `token.actions.githubusercontent.com`)
- GitHub Actions用サービスアカウント
- 指定したGCSバケットに対する `roles/storage.objectAdmin`

対象リポジトリは `var.github_repository` (`attribute_condition`) で制限しており、
それ以外のリポジトリからはこのプロバイダ経由でサービスアカウントを利用できない。

## 使い方

```bash
cp terraform.tfvars.example terraform.tfvars
# terraform.tfvars を編集(project_id, gcs_bucket_name など)

terraform init
terraform plan
terraform apply
```

state はローカルファイル(`terraform.tfstate`)に保存される。

## GitHub Actions側の設定

`terraform apply` 後、出力される `workload_identity_provider` と
`service_account_email` を使ってワークフローで認証する:

```yaml
permissions:
  id-token: write
  contents: read

steps:
  - uses: google-github-actions/auth@v2
    with:
      workload_identity_provider: ${{ vars.WORKLOAD_IDENTITY_PROVIDER }}
      service_account: ${{ vars.SERVICE_ACCOUNT_EMAIL }}
```

`workload_identity_provider` / `service_account_email` の値は、terraform出力
(`terraform output workload_identity_provider` / `terraform output service_account_email`)
をリポジトリのActions variablesに設定しておく。
