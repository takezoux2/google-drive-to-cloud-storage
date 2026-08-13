# 同期元(source)の除外設定(exclude)設計

- 日付: 2026-08-13
- ステータス: 承認済み

## 背景・目的

現在、各mappingの`driveFolderId`配下は無条件に全ファイル・全フォルダを再帰的に同期対象とする(MIME種別による自動除外を除く)。特定のファイル/フォルダをID指定、またはファイル名・フォルダ名の正規表現指定で同期対象から除外できるようにする。

## スコープ

- 各mapping(`driveFolderId`)ごとに`exclude`設定を追加する
  - `fileIds`: 除外するDriveのファイル/フォルダIDのリスト
  - `namePatterns`: 除外するファイル/フォルダ名にマッチする正規表現のリスト
- フォルダがマッチした場合、そのフォルダ配下は再帰的に同期対象から除外する(サブフォルダ・ファイルを問わず、走査自体を行わない)
- ファイルがマッチした場合、そのファイル単体を除外する(既存のMIME種別除外と同じ扱い)
- 対象外: 全mapping共通のグローバルexclude設定(mapping単位のみ)。パスベース(`sub/dir/name`)でのマッチ(名前のみが対象)

## 設定ファイル形式(YAML)

```yaml
mappings:
  - driveFolderId: "1AbC..."
    destination:
      provider: gcs
      bucket: "my-bucket"
    exclude:
      fileIds:
        - "1XyZ..." # 除外したいファイル/フォルダのDrive ID
      namePatterns:
        - "^_.*" # "_"で始まる名前のファイル/フォルダを除外
        - "\\.tmp$" # ".tmp"で終わる名前のファイルを除外
```

- `exclude`は省略可能(既存の`config.yaml`はそのまま動作する)
- `fileIds`・`namePatterns`はそれぞれ省略可能。指定した場合、いずれか一方にマッチすれば除外される
- `namePatterns`はJavaScriptの正規表現として`RegExp.test(name)`で評価する(部分一致。完全一致させたい場合は`^...$`を使う)

## アーキテクチャ

```
src/
  config/
    schema.ts           # excludeSchema 追加、mappingSchema に組み込み
  types.ts               # ExcludeConfig 型追加
  drive/
    listFiles.ts          # 除外ロジック本体(再帰走査時に判定)
  sync/
    syncRunner.ts          # syncMapping に exclude を受け渡す
  cli.ts                   # mapping.exclude を syncMapping に渡す
```

### スキーマ(`src/config/schema.ts`)

```ts
export const excludeSchema = z
  .object({
    fileIds: z.array(z.string().min(1)).optional(),
    namePatterns: z.array(z.string().min(1)).optional(),
  })
  .superRefine((data, ctx) => {
    data.namePatterns?.forEach((pattern, i) => {
      try {
        new RegExp(pattern);
      } catch {
        ctx.addIssue({
          code: "custom",
          message: `invalid regular expression: ${pattern}`,
          path: ["namePatterns", i],
        });
      }
    });
  });

export const mappingSchema = z.object({
  driveFolderId: z.string().min(1),
  destination: destinationSchema,
  exclude: excludeSchema.optional(),
});
```

不正な正規表現は設定読み込み時(`loadConfig`)にエラーとなり、Drive APIを呼ぶ前に検出できる。

### 型(`src/config/schema.ts`)

```ts
export type ExcludeConfig = z.infer<typeof excludeSchema>;
```

(実装では`types.ts`に別途正規化済みの型を定義せず、`schema.ts`の`z.infer`型を`listFiles.ts`・`syncRunner.ts`・`cli.ts`で共通利用する形にした。理由の詳細は実装計画のGlobal Constraintsを参照)

### 除外ロジック(`src/drive/listFiles.ts`)

```ts
export async function listFilesRecursively(
  drive: drive_v3.Drive,
  rootFolderId: string,
  exclude?: ExcludeConfig,
): Promise<ClassifiedFile[]>
```

- 呼び出し開始時に`namePatterns`を`RegExp[]`へ一度だけコンパイルし、`fileIds`を`Set<string>`化する
- `isExcluded(id, name)`ヘルパーで判定: `fileIdSet.has(id) || patterns.some((re) => re.test(name))`
- `walk()`内、各Driveアイテムを処理する際:
  - **フォルダ**かつ`isExcluded`→ `walk()`を呼ばずスキップ(配下は一切走査しない)
  - **ファイル**かつ`isExcluded`→ 結果配列には追加するが、`classifyMimeType`を呼ばず`conversionKind: "excluded"`を設定する(既存のMIME種別除外と同じ扱いとなり、`diff.ts`による旧ファイル削除がそのまま機能する。実装時点の`syncRunner`にファイル単位のログ出力は存在しないため、可視化は`SyncMappingResult.excluded`とCLIサマリ行の`excluded=`カウントとして別途追加した)
  - それ以外は既存の挙動のまま

### syncRunner / cli の配線

- `syncMapping`のシグネチャに第3引数(省略可)を追加: `syncMapping(driveFolderId: string, deps: SyncMappingDeps, exclude?: ExcludeConfig)`。既存の呼び出し・テストは変更不要(`exclude`未指定時は従来通り全件対象)
- `cli.ts`: `syncMapping(mapping.driveFolderId, {...}, mapping.exclude)`

## テスト方針(vitest)

- `drive/listFiles.test.ts`(既存ファイルにケース追加)
  - `fileIds`指定: 該当IDのファイルが結果に`conversionKind: "excluded"`として含まれること
  - `fileIds`指定: 該当IDのフォルダ配下が結果に一切含まれないこと(walk自体が呼ばれないこと)
  - `namePatterns`指定: 名前がマッチするファイルが`excluded`扱いになること
  - `namePatterns`指定: 名前がマッチするフォルダ配下が結果に含まれないこと
  - `exclude`未指定時は従来通り全件取得できること(回帰確認)
- `config/loadConfig.test.ts`(既存ファイルにケース追加)
  - `exclude`省略時も従来通り成功すること(回帰確認)
  - `fileIds`/`namePatterns`を指定した`exclude`が正しくパースされること
  - 不正な正規表現を`namePatterns`に指定した場合エラーになること
- `sync/syncRunner.test.ts`(既存ファイルにケース追加)
  - `syncMapping`の第3引数`exclude`が`listFilesRecursively`にそのまま渡されること

## README更新

`config.yaml`の設定例セクションに`exclude`の使用例と、フォルダ/ファイルでの挙動の違い(フォルダは配下ごと除外、ファイルは単体除外でMIME種別除外と同じ扱い)を追記する。
