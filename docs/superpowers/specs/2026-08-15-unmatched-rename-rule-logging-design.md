# マッチしなかったrenameルールのログ出力設計

- 日付: 2026-08-15
- ステータス: 承認済み

## 背景・目的

`rename`設定([2026-08-14-rename-config-design.md](2026-08-14-rename-config-design.md))はconfig全体で共通のルールリストだが、`from`のタイプミスやDrive側のファイル名変更・削除により、どのファイルにもマッチしなくなったルールが気づかれずに残る可能性がある。実行が終わった時点で、一度もマッチしなかったルールをログに出力し、気づけるようにする。

## スコープ

- 判定単位は**実行全体**(全mappingの処理が終わった後に1回だけ)。あるルールがどこか1つのmappingでマッチすれば「マッチした」扱いとし、mapping単位の個別報告はしない。
- 出力タイミング: 全mappingのループが終わった後、まとめてログに出力する。
- 出力形式: マッチしなかったルール1件につき1行、`Rename rule not matched: from="{from}" to="{to}"`。
- `--dry-run`でも通常実行でも同じように出力する(情報ログであり、削除・アップロードのような破壊的操作とは無関係のため)。
- 対象外: metadata.jsonへの記録、mapping単位での個別報告、`rename`未設定時の挙動変更(ルールが0件なら何も出力しない)。

## アーキテクチャ

```
src/
  drive/
    listFiles.ts    # applyRename がマッチしたルールのインデックスを記録する
  sync/
    syncRunner.ts    # syncMapping に matchedRenameIndices を受け渡す
  cli.ts             # 全mapping共通のSetを用意し、ループ後に未マッチルールをログ出力
```

### `listFilesRecursively`(`src/drive/listFiles.ts`)

```ts
export async function listFilesRecursively(
  drive: drive_v3.Drive,
  rootFolderId: string,
  exclude?: ExcludeConfig,
  include?: IncludeConfig,
  rename?: RenameRule[],
  matchedRenameIndices?: Set<number>,
): Promise<ClassifiedFile[]>
```

- `applyRename`がルールにマッチした際、そのルールの`rename`配列内でのインデックスを`matchedRenameIndices`(渡されていれば)に追加する。呼び出し元が複数回の`listFilesRecursively`呼び出しに同じSetインスタンスを渡すことで、実行全体での集計になる。
- インデックスは呼び出し元が渡す`rename`配列(= `config.rename`)上の位置を指す。`compileRename`は`rename`配列と同じ順序でコンパイルするため、コンパイル後の配列のインデックスがそのまま元の`rename`配列のインデックスと一致する。

### `syncMapping`(`src/sync/syncRunner.ts`)

```ts
export async function syncMapping(
  driveFolderId: string,
  deps: SyncMappingDeps,
  exclude?: ExcludeConfig,
  include?: IncludeConfig,
  rename?: RenameRule[],
  matchedRenameIndices?: Set<number>,
): Promise<SyncMappingResult>
```

- 受け取った`matchedRenameIndices`をそのまま`listFilesRecursively`に渡すだけ(ロジックはlistFiles.ts側に閉じる)。

### `cli.ts`

- mappingのループに入る前に`const matchedRenameIndices = new Set<number>();`を1つ作成する。
- 各mappingの`syncMapping`呼び出しに、`config.rename`と同じ`matchedRenameIndices`インスタンスを渡す。
- ループ終了後、`config.rename`(未設定なら何もしない)を走査し、`matchedRenameIndices`に含まれないインデックスのルールについて`console.log(\`Rename rule not matched: from="${rule.from}" to="${rule.to}"\`)`を出力する。

## テスト方針(vitest)

- `drive/listFiles.test.ts`
  - マッチしたルールのインデックスが`matchedRenameIndices`に追加されること
  - マッチしなかったルールのインデックスは追加されないこと
  - `matchedRenameIndices`未指定でも従来通り動作すること(回帰確認)
  - 複数ファイル・複数ルールで、それぞれ独立して記録されること
- `sync/syncRunner.test.ts`
  - `matchedRenameIndices`が`listFilesRecursively`にそのまま渡されること
- `cli.ts`には既存のテストファイルがないため、`pnpm build`(型チェック)と`pnpm test`(全体回帰)で検証する。手動での配線ロジック確認はコードレビューで行う。

## README更新

`rename`セクションに、マッチしなかったルールが実行後にログ出力される旨を一文追記する。
