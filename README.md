# はじめに

Google Driveのファイルを、Cloud Storage(GCS, S3)へ同期するプログラム


# 詳細

Google Driveのファイルを、ファイル化してCloud Storageへコピーし同期するプログラム

|ファイル種類|変換方法|
|:--|:--|
|Googleドキュメント|Markdownに変換してアップロード。埋め込まれた画像は削除|
|Googleスプレッドシート|CSVに変換してアップロード。シート毎にCSVファイルを保存|
|Googleスライド|除外|
|pdf|pdfのままコピー|
|テキストファイル(txt,xml,json, etc)|そのままコピー|
|画像(png, jpeg, svg)|そのままコピー|
|画像(webp, heic)|jpegに変換してコピー|
|その他|除外|

# メタデータ

コピー元のリンクを示すjsonを保存する

```json
{
  files: [
    {
      path: "{path in cloud storage}",
      originUrl: "{url}",
      linkUrl: "{url}"
    }, ...
  ],
  updatedAt: "{timestamp}"
}

```

# 使い方

## インストール

```bash
pnpm install
pnpm build
```

## 設定ファイル

`config.yaml`を作成する:

```yaml
mappings:
  - driveFolderId: "1AbCdEfGhIjKlMnOpQrStUvWxYz"
    destination:
      provider: gcs
      bucket: "my-bucket"
      prefix: "backups/team-a"

  - driveFolderId: "2XyZ..."
    destination:
      provider: s3
      bucket: "my-s3-bucket"
      region: "ap-northeast-1"
      prefix: "backups/team-b"

  - driveFolderId: "3PqRsTuVwXyZ..."
    destination:
      provider: local
      path: "./backups/team-c"
      prefix: "docs"
```

`provider: local`の場合は`bucket`の代わりに`path`(保存先ディレクトリ)を指定する。ディレクトリが存在しない場合は自動作成される。

## 認証

- Google Drive: ADC(Application Default Credentials)で取得したサービスアカウントを使用する。事前に`gcloud auth application-default login`、または`GOOGLE_APPLICATION_CREDENTIALS`環境変数でサービスアカウントキーを指定する
- GCS: Google Cloudのデフォルト認証(ADC)を使用する
- S3: AWSのデフォルト認証チェーン(環境変数、`~/.aws/credentials`、IAMロール等)を使用する

## 実行

```bash
node dist/cli.js --config config.yaml
node dist/cli.js --config config.yaml --dry-run
```
