# ローカルファイルへの保存(local provider)設計

- 日付: 2026-08-13
- ステータス: 承認済み

## 背景・目的

現在の同期先はGCS/S3の2種類のみ。ローカルファイルシステムへも同期できるようにし、クラウドアカウントを持たない環境での動作確認やバックアップ用途に対応する。

## スコープ

- `destination.provider`に`"local"`を追加し、既存のGCS/S3と同様に1つの`driveFolderId`マッピングの同期先としてローカルディレクトリを指定できるようにする
- 対象外: 1つの`driveFolderId`を複数destinationへ同時に同期する機能(既存の1マッピング1destination構成は変更しない)

## アーキテクチャ

既存の`StorageProvider`インターフェース(`upload`/`delete`/`download`)にそのまま乗せる。`syncRunner.ts`・`metadata.ts`など同期ロジック側の変更は不要。

```
src/
  storage/
    localProvider.ts   # 新規: fs/promisesベースの実装
  config/
    schema.ts           # provider: "local" 追加、path フィールド追加
  cli/
    createStorageProvider.ts  # local分岐を追加
```

## 設定ファイル形式(YAML)

```yaml
mappings:
  - driveFolderId: "3AbC..."
    destination:
      provider: local
      path: "./backups/team-c"   # 保存先ルートディレクトリ(相対 or 絶対)
      prefix: "docs"               # 省略可。path配下のサブディレクトリ
```

- `path`は`local` provider時のみ必須。`bucket`は`local`では使用しない
- `bucket`は`gcs`/`s3`では従来通り必須のまま
- `region`は従来通り`s3`のみで意味を持つ(他providerでは無視される、既存動作を踏襲)

### スキーマバリデーション(`src/config/schema.ts`)

- `provider`: `z.enum(["gcs", "s3", "local"])`
- `bucket`: `z.string().min(1).optional()`(必須制約は`superRefine`に移す)
- `path`: `z.string().min(1).optional()`(新規)
- `destinationSchema`に`superRefine`を追加し、以下を検証する:
  - `provider === "local"` → `path`が必須(未指定ならエラー)
  - `provider !== "local"` → `bucket`が必須(未指定ならエラー、従来通り)

## LocalStorageProvider の挙動(`src/storage/localProvider.ts`)

`StorageProvider`を実装するクラス。コンストラクタ引数は`(basePath: string, prefix: string = "")`(GCS/S3実装と同じ形)。

- `resolveKey(key)`: `path.join(basePath, prefix, key)`(Node標準の`path`モジュールでOS非依存に結合)
- `upload({ key, data })`: 書き込み先の親ディレクトリを`fs.mkdir(dir, { recursive: true })`で作成してから`fs.writeFile(resolvedPath, data)`。`contentType`はローカルファイルシステムでは使用しない(引数として受け取るが無視する)
- `delete(key)`: `fs.unlink(resolvedPath)`。ファイルが存在しない場合(`ENOENT`)はエラーにせず正常終了(GCSの`ignoreNotFound`と同じ挙動)。それ以外のエラーは呼び出し元に伝播する
- `download(key)`: `fs.readFile(resolvedPath)`。ファイルが存在しない場合(`ENOENT`)は`undefined`を返す。それ以外のエラーは呼び出し元に伝播する

## CLI配線(`src/cli/createStorageProvider.ts`)

`destination.provider === "local"`の場合、`new LocalStorageProvider(destination.path!, destination.prefix)`を返す分岐を追加する。

## README更新

`config.yaml`の設定例セクションに`local` providerの例を追記する。

## テスト方針(vitest)

- `storage/localProvider.test.ts`: `os.tmpdir()`配下に一時ディレクトリを作成して実ファイルI/Oで検証する(GCS/S3のようなSDKモックではなく、Node標準APIのみに依存するため実I/Oテストの方が本質的かつシンプル)
  - upload: ネストしたキー(例: `a/b/c.txt`)でも中間ディレクトリが自動作成されアップロードできること
  - upload: prefixが指定されている場合、prefix配下に保存されること
  - delete: 存在するファイルを削除できること
  - delete: 存在しないファイルを削除してもエラーにならないこと
  - download: 存在するファイルの内容を返すこと
  - download: 存在しないファイルは`undefined`を返すこと
  - テスト後に一時ディレクトリを削除する(`afterEach`等)
- `config/loadConfig.test.ts`(既存ファイルにケース追加。現状`schema.ts`単体のテストファイルは存在しないため): 以下のバリデーションケースを追加
  - `provider: local`かつ`path`未指定 → エラーになること
  - `provider: local`かつ`path`指定・`bucket`未指定 → 成功すること
  - `provider: gcs`かつ`bucket`未指定 → 従来通りエラーになること(回帰確認)
- `cli/createStorageProvider.test.ts`: `provider: local`のとき`LocalStorageProvider`が生成されること(既存のgcs/sテストと同じパターン)

## エラーハンドリング

既存方針を踏襲。個別ファイルのアップロード/削除失敗(ローカルの場合は権限エラー・ディスク容量不足等)は`syncRunner.ts`が既にtry/catchでラップしているため、追加の対応は不要。
