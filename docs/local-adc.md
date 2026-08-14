# ローカル実行時のADCスコープ初期設定

このツールはApplication Default Credentials (ADC) でGoogle Drive/Docs/Sheets APIを呼び出す(`src/drive/client.ts`)。`gcloud auth application-default login`をオプションなしで実行した場合に付与されるデフォルトスコープには、これらのAPIに必要なスコープが含まれないため、ローカル実行時は以下の手順でスコープを明示的に設定する必要がある。

## 前提知識: なぜデフォルトのままでは動かないか

`gcloud auth application-default login`を素で実行すると、以下のスコープが付与される。

- `openid`
- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/cloud-platform`
- `https://www.googleapis.com/auth/sqlservice.login`

一方、本ツールが実際に必要とするスコープは`src/drive/client.ts`の`SCOPES`で以下のように定義されている。

- `https://www.googleapis.com/auth/drive.readonly`
- `https://www.googleapis.com/auth/documents.readonly`
- `https://www.googleapis.com/auth/spreadsheets.readonly`

`cloud-platform`スコープにはDrive/Docs/Sheets APIへのアクセス権が含まれないため、デフォルト設定のままCLIを実行すると`insufficient authentication scopes`エラーになる。そのため`--scopes`オプションで必要なスコープを明示的に指定してADCを作成する。

なお、`config.yaml`の同期先(`destination.provider`)に`gcs`を指定する場合は`@google-cloud/storage`が同じADCを使って`cloud-platform`スコープでアクセスするため、`--scopes`にも`cloud-platform`を含めておくこと(後述)。

## 方法1: OAuthクライアントIDを作成する(個人利用・推奨)

Drive/Docs/SheetsのようなGoogle Cloud外のAPIにスコープを追加するには、gcloud標準のクライアントIDではなく自分で作成したOAuthクライアントIDを使う必要がある。

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials)で対象プロジェクトを開く
2. 「認証情報を作成」→「OAuthクライアントID」を選択
3. アプリケーションの種類で「デスクトップアプリ」を選択して作成
4. 作成したクライアントの認証情報JSONをダウンロードする(例: `client_secret.json`)
5. 以下を実行してブラウザ認可フローでADCを作成する

```bash
set GOOGLE_APPLICATION_CREDENTIALS=./client_secret.json
gcloud auth application-default login \
  --client-id-file=%GOOGLE_APPLICATION_CREDENTIALS% \
  --scopes="openid,https://www.googleapis.com/auth/userinfo.email,https://www.googleapis.com/auth/drive.readonly,https://www.googleapis.com/auth/documents.readonly,https://www.googleapis.com/auth/spreadsheets.readonly,https://www.googleapis.com/auth/cloud-platform"
```

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "./client_secret.json"
gcloud auth application-default login `
  --client-id-file=$env:GOOGLE_APPLICATION_CREDENTIALS `
  --scopes="openid,https://www.googleapis.com/auth/userinfo.email,https://www.googleapis.com/auth/drive.readonly,https://www.googleapis.com/auth/documents.readonly,https://www.googleapis.com/auth/spreadsheets.readonly,https://www.googleapis.com/auth/cloud-platform"
```

`gcs`宛先を使う場合は末尾に`,https://www.googleapis.com/auth/cloud-platform`を追加する。

6. ブラウザで認可した自分のGoogleアカウントに、同期対象のGoogle Driveフォルダを閲覧者として共有しておく

## 方法2: サービスアカウントをimpersonateする

チームで同じ権限セットを再現したい場合や、`terraform/gcp`で作成済みのサービスアカウントと同じ権限で動作確認したい場合はこちらを使う。事前に自分のGoogleアカウントへ対象サービスアカウントの`roles/iam.serviceAccountTokenCreator`が付与されている必要がある。

### terraformにおける権限を追加

```terraform
resource "google_service_account_iam_member" "local_impersonation" {
  service_account_id = google_service_account.github_actions.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "user:${var.impersonator_email}"
}
```
を追加し、サービスアカウントに権限を付与する


### 実行コマンド

```bash
export SERVICE_ACCOUNT_EMAIL=<SERVICE_ACCOUNT_EMAIL>

gcloud auth application-default login \
  --impersonate-service-account="$SERVICE_ACCOUNT_EMAIL" \
  --scopes="https://www.googleapis.com/auth/drive.readonly,https://www.googleapis.com/auth/documents.readonly,https://www.googleapis.com/auth/spreadsheets.readonly"
```

```powershell
 $env:SERVICE_ACCOUNT_EMAIL = "<SERVICE_ACCOUNT_EMAIL>"

gcloud auth application-default login `
  --impersonate-service-account=$env:SERVICE_ACCOUNT_EMAIL `
  --scopes="https://www.googleapis.com/auth/drive.readonly,https://www.googleapis.com/auth/documents.readonly,https://www.googleapis.com/auth/spreadsheets.readonly"
```

この場合もサービスアカウントのメールアドレスに対して、同期対象のGoogle Driveフォルダを閲覧者として共有しておく必要がある。

## 動作確認

```bash
pnpm build
node dist/cli.js --config config.yaml --dry-run
```

実行結果の1行目に`Authenticated as: <email>`が表示されれば認証情報自体は読み込めている。方法1(ユーザー認証)の場合、ADC内に`client_email`フィールドが存在しないため`Authenticated as: unavailable`と表示される場合があるが、これは想定どおりの挙動であり異常ではない。実際に権限が不足している場合はDrive/Docs/Sheets APIの呼び出し時に403エラーとなる。

## 関連ファイル

- スコープ定義: [src/drive/client.ts](../src/drive/client.ts)
- CLIエントリポイント: [src/cli.ts](../src/cli.ts)
- GCSアップロード時のADC利用: [src/cli/createStorageProvider.ts](../src/cli/createStorageProvider.ts)
