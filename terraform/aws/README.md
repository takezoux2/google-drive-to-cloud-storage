# AWS OIDC (未実装)

GitHub ActionsからAWS(S3)へOIDCで認証するためのTerraformコードは未実装。

実装時は以下が必要になる想定:

- IAM OIDC Identity Provider (`token.actions.githubusercontent.com`)
- GitHub Actions用IAM Role(信頼ポリシーで対象リポジトリを制限)
- 対象S3バケットへの最小権限ポリシー

state はGCP側と同様にローカルファイル保存とする。
