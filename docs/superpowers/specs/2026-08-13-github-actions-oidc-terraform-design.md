# GitHub Actions OIDC 認証用 Terraform (GCP) 設計

## 背景・目的

GitHub Actions上で本ツール(sync CLI)を実行し、GCSへファイルを書き込む際に、
サービスアカウントキーを使わずWorkload Identity連携(OIDC)でGCPに認証する。
Terraformでその構築コードを用意する。将来的にAWS(S3)向けの認証構成も追加する想定だが、
今回はGCP分のみ実装し、AWS用ディレクトリはプレースホルダーとする。

## ディレクトリ構成

```
terraform/
  gcp/
    versions.tf
    providers.tf
    variables.tf
    main.tf
    outputs.tf
    terraform.tfvars.example
    README.md
  aws/
    README.md   # プレースホルダー。実装は別途。
```

state はローカルファイル保存(backendブロックを指定しないデフォルト動作)。

## GCPリソース

- `google_iam_workload_identity_pool`: GitHub Actions用プール
- `google_iam_workload_identity_pool_provider`: OIDC issuer
  `https://token.actions.githubusercontent.com`。属性マッピングに
  `google.subject`, `attribute.repository`, `attribute.actor`, `attribute.ref` を設定し、
  `attribute_condition` で `assertion.repository == var.github_repository` に制限する。
- `google_service_account`: GitHub Actions用サービスアカウント
- `google_service_account_iam_member`: 上記SAに対し、該当リポジトリのWIFプリンシパルへ
  `roles/iam.workloadIdentityUser` を付与(サービスアカウントのなりすまし許可)
- `google_storage_bucket_iam_member`: 指定した `var.gcs_bucket_name` のバケットにのみ
  SAへ `roles/storage.objectAdmin` を付与(プロジェクト全体には付与しない、最小権限)

## 変数

| 変数名 | 説明 | デフォルト |
|---|---|---|
| `project_id` | GCPプロジェクトID | なし(必須) |
| `github_repository` | `owner/repo` 形式。WIFの信頼条件に使用 | `takezoux2/google-drive-to-cloud-storage` |
| `gcs_bucket_name` | SAに書き込み権限を与えるGCSバケット名 | なし(必須) |
| `pool_id` | Workload Identity Pool ID | `github-actions-pool` |
| `provider_id` | Workload Identity Pool Provider ID | `github-actions-provider` |
| `service_account_id` | サービスアカウントID | `github-actions-sync` |

`terraform.tfvars.example` に記載例を用意し、実際の値は `.gitignore` 対象の
`terraform.tfvars` に記載する。

## 出力

- `workload_identity_provider`: `google-github-actions/auth` の
  `workload_identity_provider` 入力にそのまま使える完全なリソース名
- `service_account_email`: `google-github-actions/auth` の `service_account` 入力用

## .gitignore

以下を追加する:

```
terraform/**/.terraform/
terraform/**/*.tfstate
terraform/**/*.tfstate.*
terraform/**/terraform.tfvars
terraform/**/.terraform.tfstate.lock.info
```

`*.tfvars.example` は対象外(コミットする)。`.terraform.lock.hcl` はベストプラクティスに
従いコミット対象のままとする。

## スコープ外

- AWS用の実装(IAM OIDC provider, role等)は今回作らない。`terraform/aws/README.md`
  にプレースホルダーとして今後実装予定である旨のみ記載する。
- GitHub Actionsワークフロー(.github/workflows)自体の作成は今回のスコープ外
  (READMEに使用例のみ記載)。
