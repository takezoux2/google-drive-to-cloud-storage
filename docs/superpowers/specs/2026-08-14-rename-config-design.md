# ファイルリネーム設定(rename)設計

- 日付: 2026-08-14
- ステータス: 承認済み

## 背景・目的

現在、コピー先でのファイル名はDrive上の名前(または変換処理が付与する拡張子)がそのまま使われる。特定のファイル名を別名にリネームしてコピーできるようにしたい。

## スコープ

- config全体(全mapping共通)に`rename`設定を追加する
  - `from`: リネーム対象のマッチング条件(ファイル名)
  - `to`: リネーム後の名前
- リネームは**ファイルのみ**が対象。フォルダ名はリネームしない
- `from`に拡張子が含まれていない場合、対象ファイル名の拡張子を無視してベース名のみで一致判定する
- `to`に拡張子が含まれていない場合、マッチしたファイルの元の拡張子を出力名に付与する
- 複数の`rename`ルールが定義されている場合、配列の先頭から順に評価し、最初にマッチしたルールのみを適用する(以降のルールは評価しない)
- `exclude`/`include`の判定は元のDriveファイル名に対して行う。リネームは出力パス(コピー先のファイル名)にのみ影響し、除外/包含の判定ロジックには影響しない
- 対象外: mapping単位の個別`rename`設定、正規表現によるマッチング・キャプチャ置換、フォルダ名のリネーム

## 設定ファイル形式(YAML)

```yaml
rename:
  - from: "photo" # 拡張子なし → ベース名で一致判定(photo.jpg, photo.png 等にマッチ)
    to: "cover" # 拡張子なし → マッチしたファイルの元の拡張子を維持(例: cover.jpg)
  - from: "old_report.pdf" # 拡張子あり → ファイル名と完全一致
    to: "report_2024.pdf" # 拡張子あり → そのまま出力名として使用

mappings:
  - driveFolderId: "1AbC..."
    destination:
      provider: gcs
      bucket: "my-bucket"
```

- `rename`は省略可能(既存の`config.yaml`はそのまま動作する)
- `from`・`to`はともに必須の文字列(空文字は不可)
- `from`/`to`の「拡張子指定の有無」はNode.jsの`path.extname()`と同じ規則で判定する(例: `.gitignore`のような先頭ドットのみのファイル名は拡張子なし扱い)

## アーキテクチャ

```
src/
  config/
    schema.ts           # renameRuleSchema 追加、configSchema に組み込み
  drive/
    listFiles.ts          # リネームロジック本体(再帰走査時、ファイル分岐でのみ適用)
  sync/
    syncRunner.ts          # syncMapping に rename を受け渡す
  cli.ts                   # config.rename を各 syncMapping 呼び出しに渡す
```

### スキーマ(`src/config/schema.ts`)

```ts
export const renameRuleSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

export const configSchema = z.object({
  mappings: z.array(mappingSchema).min(1),
  rename: z.array(renameRuleSchema).optional(),
});

export type RenameRule = z.infer<typeof renameRuleSchema>;
```

### リネームロジック(`src/drive/listFiles.ts`)

```ts
export async function listFilesRecursively(
  drive: drive_v3.Drive,
  rootFolderId: string,
  exclude?: ExcludeConfig,
  include?: IncludeConfig,
  rename?: RenameRule[],
): Promise<ClassifiedFile[]>
```

- 呼び出し開始時に`rename`ルールを一度だけコンパイルする(各ルールについて`path.extname(from)`・`path.extname(to)`を事前計算し、拡張子指定の有無を判定しておく)
- `applyRename(compiledRules, name): string`ヘルパー:
  - 対象`name`を`path.extname(name)`でベース名と拡張子に分解する
  - ルールを先頭から順に評価し、`from`に拡張子があれば`name === from`、なければ`base === from`で一致判定する
  - 一致したら、`to`に拡張子があれば`to`をそのまま返す。なければ`to + 対象nameの元の拡張子`を返す
  - どのルールにも一致しなければ`name`をそのまま返す
- `walk()`内、**ファイル**分岐でのみ`applyRename`を適用する:
  - `isExcluded`/`isIncluded`の判定は元の`file.name`に対して行う(現状維持)
  - 出力する`path`・`ClassifiedFile.name`は`applyRename`後の名前を使って組み立てる
  - **フォルダ**分岐は変更しない(フォルダ名はリネーム対象外なので、`walk()`への再帰呼び出しは元の`file.name`のまま)
- 変換処理(`convert/dispatch.ts`)は`file.path`を入力として拡張子の付与・置換を行っている(例: `${file.path}.md`、`.replace(/\.[^./]+$/, ".jpg")`)ため、変更不要。リネーム後の`file.path`がそのまま渡ることで、Googleドキュメント→Markdown変換時の`.md`付与や画像→JPEG変換時の拡張子置換は従来通り正しく機能する

### syncRunner / cli の配線

- `syncMapping`のシグネチャに第5引数(省略可)を追加: `syncMapping(driveFolderId: string, deps: SyncMappingDeps, exclude?: ExcludeConfig, include?: IncludeConfig, rename?: RenameRule[])`。既存の呼び出し・テストは変更不要(`rename`未指定時は従来通りリネームなし)
- `cli.ts`: 各mappingループで`syncMapping(mapping.driveFolderId, {...}, mapping.exclude, mapping.include, config.rename)`(`rename`はconfig全体で共通のため、全mapping呼び出しに同じ配列を渡す)

## テスト方針(vitest)

- `drive/listFiles.test.ts`(既存ファイルにケース追加)
  - 拡張子なし`from`が、異なる拡張子を持つ複数ファイルのベース名にマッチしてリネームされること
  - 拡張子あり`from`が、完全一致するファイル名のみリネームされること(拡張子違いはマッチしないこと)
  - 拡張子なし`to`が、マッチしたファイルの元の拡張子を維持すること
  - 拡張子あり`to`が、そのまま出力名として使われること
  - 複数ルールが定義されている場合、最初にマッチしたルールのみが適用されること
  - フォルダ名はリネーム対象にならないこと(フォルダ名が`from`と一致してもリネームされず、配下の走査・パスにも影響しないこと)
  - `exclude`/`include`の判定がリネーム後ではなく元のファイル名に対して行われること
  - `rename`未指定時は従来通りリネームなしで動作すること(回帰確認)
- `config/loadConfig.test.ts`(既存ファイルにケース追加)
  - `rename`省略時も従来通り成功すること(回帰確認)
  - `from`/`to`を指定した`rename`が正しくパースされること
  - `from`/`to`が空文字の場合エラーになること
- `sync/syncRunner.test.ts`(既存ファイルにケース追加)
  - `syncMapping`の第5引数`rename`が`listFilesRecursively`にそのまま渡されること

## README更新

`config.yaml`の設定例セクションに`rename`の使用例を追記し、拡張子指定の有無によるマッチング・出力名決定の挙動、フォルダ非対応、複数ルール時の先勝ちルールを説明する。
