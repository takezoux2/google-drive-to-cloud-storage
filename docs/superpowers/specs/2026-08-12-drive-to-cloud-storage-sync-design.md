# Google Drive → Cloud Storage 同期CLI 設計

- 日付: 2026-08-12
- ステータス: 承認済み

## 背景・目的

README記載の通り、Google Driveのファイルをファイル種別に応じて変換しつつ、Cloud Storage(GCS/S3)へ同期するTypeScript製コマンドラインプログラムを実装する。

## スコープ

- Google Driveの指定フォルダ(複数可)配下を再帰的に走査し、ファイル種別ごとに変換してCloud Storageへアップロードする一回実行型のCLIコマンド
- 差分同期(追加・更新・削除)とメタデータ管理(`metadata.json`)
- GCS・S3の両方をコピー先としてサポート
- 対象外: 常駐監視(watch)モード、Webhookトリガー、E2Eテスト(実際のGoogle/クラウドサービスへの接続確認は手動)

## ファイル種別と変換方法

README記載の表に準拠する:

| ファイル種類 | 変換方法 |
|:--|:--|
| Googleドキュメント | Markdownに変換してアップロード。埋め込まれた画像は削除 |
| Googleスプレッドシート | CSVに変換してアップロード。シート毎にCSVファイルを保存 |
| Googleスライド | 除外 |
| pdf | pdfのままコピー |
| テキストファイル(txt,xml,json, etc) | そのままコピー |
| 画像(png, jpeg, svg) | そのままコピー |
| 画像(webp, heic) | jpegに変換してコピー |
| その他 | 除外 |

## 認証

- Google Drive/Docs/Sheets: ADC(Application Default Credentials)経由で取得したサービスアカウントを使用。`google-auth-library`の`GoogleAuth`を用い、スコープは以下:
  - `https://www.googleapis.com/auth/drive.readonly`
  - `https://www.googleapis.com/auth/documents.readonly`
  - `https://www.googleapis.com/auth/spreadsheets.readonly`
- GCS: `@google-cloud/storage`のデフォルト認証(ADC)
- S3: `@aws-sdk/client-s3`のデフォルト認証チェーン(環境変数 / `~/.aws/credentials` / IAMロール等)
- 認証情報は設定ファイルに記述しない

## アーキテクチャ

```
src/
  cli.ts                  # エントリポイント (commander)
  config/
    schema.ts             # 設定ファイルのZodスキーマ
    loadConfig.ts          # YAML読み込み・検証
  drive/
    client.ts             # googleapis Drive/Docs/Sheets クライアント
    listFiles.ts           # フォルダ再帰列挙
    convert/
      docs.ts              # Googleドキュメント→Markdown (docs-markdown + 画像除去)
      sheets.ts             # Googleスプレッドシート→シート毎CSV
      image.ts              # webp/heic→jpeg (sharp)
      passthrough.ts        # pdf/テキスト/png/jpeg/svgはそのまま
      classify.ts           # ファイル種別→変換方法の判定
  storage/
    StorageProvider.ts     # インターフェース (upload/delete/list)
    gcsProvider.ts          # @google-cloud/storage実装
    s3Provider.ts            # @aws-sdk/client-s3実装
  sync/
    metadata.ts             # metadata.json 読み書き
    diff.ts                  # Drive一覧とmetadataの比較(追加/更新/削除判定)
    syncRunner.ts             # 全体オーケストレーション
  logger.ts
```

### 主要ライブラリ

- CLI: `commander`
- 設定: `yaml` + `zod`(バリデーション)
- Google API: `googleapis`(Drive v3 / Docs v1 / Sheets v4)
- Docs→Markdown: `docs-markdown`パッケージの`googleDocsToMarkdown(document)`関数。引数はDocs API `documents.get`のレスポンス(document JSON)。変換後、生成されたMarkdown中の画像記法(`![...](...)`)を正規表現で除去する
- Sheets→CSV: Sheets API(`spreadsheets.get`でシート一覧取得 → シート毎に`spreadsheets.values.get`で値取得)し、自前でCSV文字列に変換(カンマ・改行・ダブルクォートのエスケープを実装)
- 画像変換: `sharp`(webp/heic→jpeg)
- GCS: `@google-cloud/storage`
- S3: `@aws-sdk/client-s3`
- テスト: `vitest`
- Lint/Format: `biome`
- パッケージ管理/ビルド: `pnpm` + `tsc`(ESM、`cli.ts`先頭に`#!/usr/bin/env node`を付与しshebangを保持)

## 設定ファイル形式(YAML)

```yaml
mappings:
  - driveFolderId: "1AbCdEfGhIjKlMnOpQrStUvWxYz"
    destination:
      provider: gcs          # gcs | s3
      bucket: "my-bucket"
      prefix: "backups/team-a"   # 省略可

  - driveFolderId: "2XyZ..."
    destination:
      provider: s3
      bucket: "my-s3-bucket"
      region: "ap-northeast-1"
      prefix: "backups/team-b"
```

- `driveFolderId`ごとに1つの`destination`(コピー先バケット/プレフィックス)を対応させる
- CLI呼び出し例: `sync --config config.yaml`。`--dry-run`オプションで実際のアップロード・削除を行わず、変更予定一覧のみ標準出力に表示する

## メタデータ(`metadata.json`)

各`destination`(bucket + prefix)のルートに1つ保存する。README記載のスキーマを拡張し、差分判定に必要な`modifiedTime`を追加する:

```json
{
  "files": [
    {
      "path": "docs/report.md",
      "originUrl": "https://docs.google.com/document/d/xxx/edit",
      "linkUrl": "https://docs.google.com/document/d/xxx/edit",
      "modifiedTime": "2026-08-01T12:34:56.000Z"
    }
  ],
  "updatedAt": "2026-08-12T09:00:00.000Z"
}
```

## データフロー(1マッピングあたり)

1. コピー先(bucket + prefix)から既存の`metadata.json`を読み込む(存在しなければ`files: []`として扱う)
2. Drive APIで`driveFolderId`配下を再帰的に一覧取得(ファイルID・name・mimeType・modifiedTime・Drive上のフォルダ階層から導いた相対パス)
3. `classify.ts`でファイル種別ごとの変換方法を判定。Googleスライド・その他は除外(一覧から取り除く)
4. `diff.ts`でDrive一覧とmetadataを比較:
   - Drive側にあり、metadataに存在しない、またはmetadataの`modifiedTime`より新しい → **追加/更新対象**
   - metadataに存在し、Drive側の一覧(除外後)に存在しない → **削除対象**
5. 追加/更新対象を種別に応じて変換し、`StorageProvider.upload`でアップロード
6. 削除対象を`StorageProvider.delete`で削除
7. 新しい`metadata.json`(処理後の全ファイルのpath・originUrl・linkUrl・modifiedTime、および`updatedAt`)を書き戻す

## エラーハンドリング

- 個別ファイルの変換・アップロード失敗はログに記録して処理を継続する。全マッピング処理後にサマリ(成功/失敗件数)を表示し、1件でも失敗があればexit code 1で終了する
- 認証エラー・設定ファイルの検証エラーなど致命的なものは、その時点で処理を中断してエラーメッセージを表示しexit code 1で終了する

## テスト方針(vitest)

- `classify.ts`: mimeTypeごとの変換方法判定の単体テスト
- `diff.ts`: Drive一覧×metadataの組み合わせパターン(新規/更新/削除/変化なし)に対する単体テスト
- `convert/docs.ts`: docs-markdownの出力から画像記法が除去されることの単体テスト
- `convert/sheets.ts`: シート値からのCSV変換(カンマ・改行・ダブルクォートを含む値のエスケープ)の単体テスト
- `convert/image.ts`: sharpの呼び出しパラメータ検証(モック)
- `storage/gcsProvider.ts` / `storage/s3Provider.ts`: SDKクライアントをモックし、upload/delete呼び出しパラメータを検証
- `sync/syncRunner.ts`: 上記すべてをモックした統合的なユニットテストで全体フロー(追加/更新/削除/メタデータ書き戻し)を検証
- 対象外: 実際のGoogle Drive/GCS/S3に接続するE2Eテスト(手動確認)
