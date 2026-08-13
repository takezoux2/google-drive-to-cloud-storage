# インフラ構築(Terraform / GCP)

GCP上のリソース(Workload Identity Federation、GitHub Actions用サービスアカウントなど)は
[`terraform/gcp`](../terraform/gcp) で管理する。dev/prdなど環境の切り替えは
`terraform workspace` を使う。

## 前提

- terraform `>= 1.5.0`
- `gcloud auth application-default login` 済みで、対象GCPプロジェクトへの権限があること

## 環境の切り替え方式

同一のTerraformコード・同一バックエンド上で、`terraform workspace` によって環境ごとに
state を分離する。環境固有の値(`project_id` / `gcs_bucket_name` など)は
workspaceごとの `.tfvars` ファイル(`dev.tfvars` / `prd.tfvars`)に分けて管理する。

これらの `.tfvars` ファイルは `.gitignore` で除外されておりコミットされない
(`terraform.tfvars.example` のみコミット対象)。

### 誤爆防止

`var.environment` は、apply対象の値が現在選択中のworkspace名と一致するかを
[`variables.tf`](../terraform/gcp/variables.tf) の `validation` ブロックでチェックしている。

```hcl
variable "environment" {
  ...
  validation {
    condition     = var.environment == terraform.workspace
    error_message = "..."
  }
}
```

これにより、例えば `prd` workspaceを選択した状態で誤って `dev.tfvars`
(`environment = "dev"`)を指定してapplyしようとすると、plan/apply実行前にエラーで
止まる。「workspaceの選択」と「tfvarsファイルの指定」を両方間違えない限り事故は起きない。

### リソース名の衝突回避

`pool_id` / `provider_id` / `service_account_id` には `var.environment` のサフィックスが
付与される(例: `github-actions-pool-dev`, `github-actions-pool-prd`)。dev/prdで
同一GCPプロジェクトを共有した場合でも、GCP側でリソースIDが衝突しないようにするため。

## 初回セットアップ

```bash
cd terraform/gcp
terraform init

# workspaceを作成(まだ無ければ)
terraform workspace new dev
terraform workspace new prd

# 環境別tfvarsを用意
cp terraform.tfvars.example dev.tfvars
cp terraform.tfvars.example prd.tfvars
```

`dev.tfvars` / `prd.tfvars` を編集する。各ファイルの `environment` は自分自身の環境名
(`"dev"` / `"prd"`)にすること。

```hcl
environment         = "dev"
project_id          = "your-dev-project"
github_repository   = "takezoux2/google-drive-to-cloud-storage"
gcs_bucket_name     = "your-dev-bucket"
impersonator_email  = "you@example.com"
```

## 環境への適用

```bash
# dev環境
terraform workspace select dev
terraform plan  -var-file=dev.tfvars
terraform apply -var-file=dev.tfvars

# prd環境
terraform workspace select prd
terraform plan  -var-file=prd.tfvars
terraform apply -var-file=prd.tfvars
```

現在選択中のworkspace、および一覧の確認:

```bash
terraform workspace show
terraform workspace list
```

## state の保存場所

ローカルバックエンド(デフォルト)を使用しているため、workspaceごとに以下へstateが
分かれて保存される。

- `default` workspace: `terraform.tfstate`
- 各workspace: `terraform.tfstate.d/<workspace名>/terraform.tfstate`

いずれも `.gitignore` で除外されておりコミットされない。チームで共有する場合は
GCSなどのリモートバックエンドへの移行を検討すること(現状は個人利用のためローカルのまま)。

## 破棄

```bash
terraform workspace select dev
terraform destroy -var-file=dev.tfvars
```

## GitHub Actions側の設定

`terraform apply` 後、環境ごとに出力される `workload_identity_provider` と
`service_account_email` を確認する(workspaceを切り替えてから実行すること)。

```bash
terraform workspace select dev
terraform output workload_identity_provider
terraform output service_account_email
```

出力値は、リポジトリのActions variables(GitHub Environmentsを使う場合は環境ごとの
variables)に設定しておく。

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

## 関連ファイル

- Terraform本体: [terraform/gcp](../terraform/gcp)
- ローカルADC設定: [docs/local-adc.md](./local-adc.md)
