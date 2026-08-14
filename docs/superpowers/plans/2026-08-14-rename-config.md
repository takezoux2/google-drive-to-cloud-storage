# ファイルリネーム設定(rename) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** config全体で共通の`rename`設定(`from`/`to`のリスト)を追加し、Driveファイルをコピー先へ同期する際にファイル名をリネームできるようにする。

**Architecture:** `configSchema`に`rename`配列を追加し、`listFilesRecursively`の再帰走査中、ファイル(フォルダは対象外)についてのみリネーム後の名前で出力`path`を組み立てる。`exclude`/`include`の判定は従来通り元のDriveファイル名に対して行う。`rename`はconfig全体で共通のため、`cli.ts`から全mappingの`syncMapping`呼び出しに同じ`config.rename`を渡す。

**Tech Stack:** TypeScript, Zod(スキーマ検証), vitest(テスト), Node.js `node:path`の`extname`

## Global Constraints

- `rename`はconfig全体で共通(mapping単位の個別設定はしない) — 仕様: [2026-08-14-rename-config-design.md](../specs/2026-08-14-rename-config-design.md)
- リネームはファイルのみが対象。フォルダ名はリネームしない
- `from`に拡張子が含まれない場合、対象ファイル名の拡張子を無視してベース名のみで一致判定する
- `to`に拡張子が含まれない場合、マッチしたファイルの元の拡張子を出力名に付与する
- 複数ルールがマッチしうる場合、配列の先頭から順に評価し、最初にマッチしたルールのみを適用する
- `exclude`/`include`の判定は元のDriveファイル名(リネーム前)に対して行う
- 「拡張子指定の有無」の判定はNode.jsの`path.extname()`と同じ規則に従う
- `rename`は省略可能。既存の`config.yaml`はそのまま動作する(後方互換性を壊さない)
- 既存の`syncMapping`・`listFilesRecursively`の呼び出し元(テスト含む)は、`rename`引数を省略した場合、従来通りリネームなしで動作する

---

## File Structure

- `src/config/schema.ts` — `renameRuleSchema`を追加、`configSchema`に`rename`フィールドを追加、`RenameRule`型をエクスポート
- `src/config/loadConfig.test.ts` — `rename`のパース・バリデーションのテストケースを追加
- `src/drive/listFiles.ts` — `compileRename`/`applyRename`ヘルパーを追加し、`walk()`のファイル分岐でリネームを適用。`listFilesRecursively`のシグネチャに`rename`引数を追加
- `src/drive/listFiles.test.ts` — リネームの挙動(拡張子あり/なしのマッチング・出力名決定、フォルダ非対象、複数ルールの先勝ち、exclude/includeとの相互作用)のテストケースを追加
- `src/sync/syncRunner.ts` — `syncMapping`のシグネチャに`rename`引数を追加し、`listFilesRecursively`にそのまま渡す
- `src/sync/syncRunner.test.ts` — `rename`引数が`listFilesRecursively`にそのまま渡されることを確認するテストケースを追加
- `src/cli.ts` — 各mappingループの`syncMapping`呼び出しに`config.rename`を渡す
- `README.md` — `rename`設定の使用例と挙動の説明を追記

---

### Task 1: config スキーマに `rename` を追加

**Files:**
- Modify: `src/config/schema.ts`
- Test: `src/config/loadConfig.test.ts`

**Interfaces:**
- Produces: `renameRuleSchema`(zodスキーマ)、`RenameRule`型(`{ from: string; to: string }`)、`configSchema`が`rename?: RenameRule[]`フィールドを持つ

- [ ] **Step 1: Write the failing tests**

`src/config/loadConfig.test.ts`の末尾(最後の`it`ブロックの後、`});`の直前)に以下のテストケースを追加する:

```ts
  it("parses config-level rename rules", async () => {
    const configPath = path.join(dir, "rename.yaml");
    await writeFile(
      configPath,
      `
rename:
  - from: "photo"
    to: "cover"
  - from: "old_report.pdf"
    to: "report_2024.pdf"
mappings:
  - driveFolderId: "abc123"
    destination:
      provider: gcs
      bucket: "my-bucket"
`,
      "utf-8",
    );

    const config = await loadConfig(configPath);

    expect(config.rename).toEqual([
      { from: "photo", to: "cover" },
      { from: "old_report.pdf", to: "report_2024.pdf" },
    ]);
  });

  it("parses a config with no rename block (backward compatible)", async () => {
    const configPath = path.join(dir, "no-rename.yaml");
    await writeFile(
      configPath,
      `
mappings:
  - driveFolderId: "abc123"
    destination:
      provider: gcs
      bucket: "my-bucket"
`,
      "utf-8",
    );

    const config = await loadConfig(configPath);

    expect(config.rename).toBeUndefined();
  });

  it("throws when a rename rule has an empty from", async () => {
    const configPath = path.join(dir, "rename-empty-from.yaml");
    await writeFile(
      configPath,
      `
rename:
  - from: ""
    to: "cover"
mappings:
  - driveFolderId: "abc123"
    destination:
      provider: gcs
      bucket: "my-bucket"
`,
      "utf-8",
    );

    await expect(loadConfig(configPath)).rejects.toThrow();
  });

  it("throws when a rename rule has an empty to", async () => {
    const configPath = path.join(dir, "rename-empty-to.yaml");
    await writeFile(
      configPath,
      `
rename:
  - from: "photo"
    to: ""
mappings:
  - driveFolderId: "abc123"
    destination:
      provider: gcs
      bucket: "my-bucket"
`,
      "utf-8",
    );

    await expect(loadConfig(configPath)).rejects.toThrow();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test loadConfig`
Expected: FAIL — `config.rename` is `undefined`/property does not exist under the current schema (the "parses config-level rename rules" case fails because `rename` is stripped by zod as an unrecognized key is not the failure mode here — zod by default ignores unknown keys, so this test will fail on the `toEqual` assertion since `config.rename` is `undefined`, not the expected array).

- [ ] **Step 3: Implement the schema change**

In `src/config/schema.ts`, add `renameRuleSchema` after `includeSchema` (before `mappingSchema`):

```ts
export const renameRuleSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});
```

Update `configSchema` to include the new optional field:

```ts
export const configSchema = z.object({
  mappings: z.array(mappingSchema).min(1),
  rename: z.array(renameRuleSchema).optional(),
});
```

Add the type export alongside the other type exports at the bottom of the file:

```ts
export type RenameRule = z.infer<typeof renameRuleSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test loadConfig`
Expected: PASS (all `loadConfig.test.ts` cases, including the 4 new ones)

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts src/config/loadConfig.test.ts
git commit -m "feat: add rename config schema"
```

---

### Task 2: `listFiles.ts` にリネームロジックを実装

**Files:**
- Modify: `src/drive/listFiles.ts`
- Test: `src/drive/listFiles.test.ts`

**Interfaces:**
- Consumes: `RenameRule` type from `src/config/schema.ts` (Task 1) — `{ from: string; to: string }`
- Produces: `listFilesRecursively(drive, rootFolderId, exclude?, include?, rename?: RenameRule[])` — 5th parameter, optional, defaults to no renaming when omitted

- [ ] **Step 1: Write the failing tests**

Add the following test cases to `src/drive/listFiles.test.ts`, inside the existing `describe("listFilesRecursively", ...)` block (after the last existing `it`, before the closing `});`):

```ts
  it("renames a file whose base name matches an extension-less from rule, keeping the original extension", async () => {
    const list = vi.fn().mockResolvedValue({
      data: {
        files: [
          {
            id: "file-photo",
            name: "photo.jpg",
            mimeType: "image/jpeg",
            modifiedTime: "2026-08-01T00:00:00.000Z",
            parents: ["root"],
          },
        ],
      },
    });
    const drive = { files: { list } } as unknown as drive_v3.Drive;

    const result = await listFilesRecursively(
      drive,
      "root",
      undefined,
      undefined,
      [{ from: "photo", to: "cover" }],
    );

    expect(result.find((f) => f.id === "file-photo")?.path).toBe("cover.jpg");
    expect(result.find((f) => f.id === "file-photo")?.name).toBe("cover.jpg");
  });

  it("does not rename a file when from has an extension that does not match", async () => {
    const list = vi.fn().mockResolvedValue({
      data: {
        files: [
          {
            id: "file-photo",
            name: "photo.png",
            mimeType: "image/png",
            modifiedTime: "2026-08-01T00:00:00.000Z",
            parents: ["root"],
          },
        ],
      },
    });
    const drive = { files: { list } } as unknown as drive_v3.Drive;

    const result = await listFilesRecursively(
      drive,
      "root",
      undefined,
      undefined,
      [{ from: "photo.jpg", to: "cover.jpg" }],
    );

    expect(result.find((f) => f.id === "file-photo")?.path).toBe("photo.png");
  });

  it("renames a file when from has an extension that matches exactly", async () => {
    const list = vi.fn().mockResolvedValue({
      data: {
        files: [
          {
            id: "file-report",
            name: "old_report.pdf",
            mimeType: "application/pdf",
            modifiedTime: "2026-08-01T00:00:00.000Z",
            parents: ["root"],
          },
        ],
      },
    });
    const drive = { files: { list } } as unknown as drive_v3.Drive;

    const result = await listFilesRecursively(
      drive,
      "root",
      undefined,
      undefined,
      [{ from: "old_report.pdf", to: "report_2024.pdf" }],
    );

    expect(result.find((f) => f.id === "file-report")?.path).toBe(
      "report_2024.pdf",
    );
  });

  it("uses to verbatim as the output name when to has an extension", async () => {
    const list = vi.fn().mockResolvedValue({
      data: {
        files: [
          {
            id: "file-photo",
            name: "photo.webp",
            mimeType: "image/webp",
            modifiedTime: "2026-08-01T00:00:00.000Z",
            parents: ["root"],
          },
        ],
      },
    });
    const drive = { files: { list } } as unknown as drive_v3.Drive;

    const result = await listFilesRecursively(
      drive,
      "root",
      undefined,
      undefined,
      [{ from: "photo", to: "cover.jpg" }],
    );

    expect(result.find((f) => f.id === "file-photo")?.path).toBe("cover.jpg");
  });

  it("keeps a file without an extension unrenamed-in-extension when to has no extension (e.g. Google Docs)", async () => {
    const list = vi.fn().mockResolvedValue({
      data: {
        files: [
          {
            id: "file-doc",
            name: "Meeting Notes",
            mimeType: "application/vnd.google-apps.document",
            modifiedTime: "2026-08-01T00:00:00.000Z",
            parents: ["root"],
          },
        ],
      },
    });
    const drive = { files: { list } } as unknown as drive_v3.Drive;

    const result = await listFilesRecursively(
      drive,
      "root",
      undefined,
      undefined,
      [{ from: "Meeting Notes", to: "Notes" }],
    );

    expect(result.find((f) => f.id === "file-doc")?.path).toBe("Notes");
  });

  it("applies only the first matching rename rule when multiple rules could match", async () => {
    const list = vi.fn().mockResolvedValue({
      data: {
        files: [
          {
            id: "file-photo",
            name: "photo.jpg",
            mimeType: "image/jpeg",
            modifiedTime: "2026-08-01T00:00:00.000Z",
            parents: ["root"],
          },
        ],
      },
    });
    const drive = { files: { list } } as unknown as drive_v3.Drive;

    const result = await listFilesRecursively(
      drive,
      "root",
      undefined,
      undefined,
      [
        { from: "photo", to: "first-match" },
        { from: "photo", to: "second-match" },
      ],
    );

    expect(result.find((f) => f.id === "file-photo")?.path).toBe(
      "first-match.jpg",
    );
  });

  it("does not rename folders even when a folder name matches a rename rule", async () => {
    const list = vi.fn().mockImplementation(({ q }: { q: string }) => {
      if (q.includes("'root'")) {
        return Promise.resolve({
          data: {
            files: [
              {
                id: "folder-photo",
                name: "photo",
                mimeType: "application/vnd.google-apps.folder",
                modifiedTime: "2026-08-01T00:00:00.000Z",
                parents: ["root"],
              },
            ],
          },
        });
      }
      return Promise.resolve({
        data: {
          files: [
            {
              id: "file-inside",
              name: "inside.txt",
              mimeType: "text/plain",
              modifiedTime: "2026-08-01T00:00:00.000Z",
              parents: ["folder-photo"],
            },
          ],
        },
      });
    });
    const drive = { files: { list } } as unknown as drive_v3.Drive;

    const result = await listFilesRecursively(
      drive,
      "root",
      undefined,
      undefined,
      [{ from: "photo", to: "cover" }],
    );

    expect(result.find((f) => f.id === "file-inside")?.path).toBe(
      "photo/inside.txt",
    );
  });

  it("evaluates exclude/include against the original file name, not the renamed name", async () => {
    const list = vi.fn().mockResolvedValue({
      data: {
        files: [
          {
            id: "file-photo",
            name: "photo.jpg",
            mimeType: "image/jpeg",
            modifiedTime: "2026-08-01T00:00:00.000Z",
            parents: ["root"],
          },
        ],
      },
    });
    const drive = { files: { list } } as unknown as drive_v3.Drive;

    const result = await listFilesRecursively(
      drive,
      "root",
      { namePatterns: ["^photo"] },
      undefined,
      [{ from: "photo", to: "cover" }],
    );

    expect(result.find((f) => f.id === "file-photo")?.conversionKind).toBe(
      "excluded",
    );
    expect(result.find((f) => f.id === "file-photo")?.path).toBe("cover.jpg");
  });

  it("behaves exactly as before when rename is omitted", async () => {
    const list = vi.fn().mockResolvedValue({
      data: {
        files: [
          {
            id: "file-1",
            name: "readme.txt",
            mimeType: "text/plain",
            modifiedTime: "2026-08-01T00:00:00.000Z",
            parents: ["root"],
          },
        ],
      },
    });
    const drive = { files: { list } } as unknown as drive_v3.Drive;

    const result = await listFilesRecursively(drive, "root");

    expect(result[0].path).toBe("readme.txt");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test listFiles`
Expected: FAIL — `listFilesRecursively` currently only accepts 4 parameters and performs no renaming, so every renaming assertion (`.path` equal to a renamed value) fails; the exclude/include-related new tests also fail to compile-time-safely pass their 5th argument until the signature is updated (TypeScript will report an excess-argument error when running via `tsx`/`vitest`, which surfaces as a test run failure).

- [ ] **Step 3: Implement the rename logic**

Replace the full contents of `src/drive/listFiles.ts` with:

```ts
import { extname } from "node:path";
import type { drive_v3 } from "googleapis";
import type {
  ExcludeConfig,
  IncludeConfig,
  RenameRule,
} from "../config/schema.js";
import type { ClassifiedFile } from "../types.js";
import { classifyMimeType } from "./convert/classify.js";

const FOLDER_MIME = "application/vnd.google-apps.folder";

interface CompiledExclude {
  fileIds: Set<string>;
  namePatterns: RegExp[];
}

interface CompiledInclude {
  active: boolean;
  fileIds: Set<string>;
  namePatterns: RegExp[];
}

interface CompiledRenameRule {
  from: string;
  fromExt: string;
  to: string;
  toExt: string;
}

function compileExclude(exclude?: ExcludeConfig): CompiledExclude {
  return {
    fileIds: new Set(exclude?.fileIds ?? []),
    namePatterns: (exclude?.namePatterns ?? []).map((p) => new RegExp(p)),
  };
}

function compileInclude(include?: IncludeConfig): CompiledInclude {
  const fileIds = include?.fileIds ?? [];
  const namePatterns = include?.namePatterns ?? [];
  return {
    active: fileIds.length > 0 || namePatterns.length > 0,
    fileIds: new Set(fileIds),
    namePatterns: namePatterns.map((p) => new RegExp(p)),
  };
}

function compileRename(rules?: RenameRule[]): CompiledRenameRule[] {
  return (rules ?? []).map((rule) => ({
    from: rule.from,
    fromExt: extname(rule.from),
    to: rule.to,
    toExt: extname(rule.to),
  }));
}

function isExcluded(
  compiled: CompiledExclude,
  id: string,
  name: string,
): boolean {
  if (compiled.fileIds.has(id)) return true;
  return compiled.namePatterns.some((re) => re.test(name));
}

function isIncluded(compiled: CompiledInclude, id: string, name: string): boolean {
  if (!compiled.active) return true;
  if (compiled.fileIds.has(id)) return true;
  return compiled.namePatterns.some((re) => re.test(name));
}

function splitExt(name: string): { base: string; ext: string } {
  const ext = extname(name);
  return ext ? { base: name.slice(0, -ext.length), ext } : { base: name, ext: "" };
}

function applyRename(rules: CompiledRenameRule[], name: string): string {
  const { base, ext } = splitExt(name);
  for (const rule of rules) {
    const matched = rule.fromExt ? name === rule.from : base === rule.from;
    if (matched) {
      return rule.toExt ? rule.to : `${rule.to}${ext}`;
    }
  }
  return name;
}

export async function listFilesRecursively(
  drive: drive_v3.Drive,
  rootFolderId: string,
  exclude?: ExcludeConfig,
  include?: IncludeConfig,
  rename?: RenameRule[],
): Promise<ClassifiedFile[]> {
  const result: ClassifiedFile[] = [];
  const compiledExclude = compileExclude(exclude);
  const compiledInclude = compileInclude(include);
  const compiledRename = compileRename(rename);
  await walk(
    drive,
    rootFolderId,
    "",
    result,
    compiledExclude,
    compiledInclude,
    compiledRename,
  );
  return result;
}

async function walk(
  drive: drive_v3.Drive,
  folderId: string,
  pathPrefix: string,
  result: ClassifiedFile[],
  exclude: CompiledExclude,
  include: CompiledInclude,
  rename: CompiledRenameRule[],
): Promise<void> {
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, modifiedTime, parents)",
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const files = res.data.files ?? [];
    for (const file of files) {
      if (!file.id || !file.name || !file.mimeType || !file.modifiedTime)
        continue;
      if (file.mimeType === FOLDER_MIME) {
        const path = pathPrefix ? `${pathPrefix}/${file.name}` : file.name;
        if (isExcluded(exclude, file.id, file.name)) continue;
        await walk(drive, file.id, path, result, exclude, include, rename);
      } else {
        const outputName = applyRename(rename, file.name);
        const path = pathPrefix ? `${pathPrefix}/${outputName}` : outputName;
        const notIncluded = !isIncluded(include, file.id, file.name);
        const excluded = notIncluded || isExcluded(exclude, file.id, file.name);
        result.push({
          id: file.id,
          name: outputName,
          mimeType: file.mimeType,
          modifiedTime: file.modifiedTime,
          path,
          parents: file.parents ?? [],
          conversionKind: excluded
            ? "excluded"
            : classifyMimeType(file.mimeType),
        });
      }
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test listFiles`
Expected: PASS (all `listFiles.test.ts` cases, including the 8 new ones)

- [ ] **Step 5: Commit**

```bash
git add src/drive/listFiles.ts src/drive/listFiles.test.ts
git commit -m "feat: apply rename rules to files during Drive tree walk"
```

---

### Task 3: `syncRunner.ts` に `rename` を配線

**Files:**
- Modify: `src/sync/syncRunner.ts`
- Test: `src/sync/syncRunner.test.ts`

**Interfaces:**
- Consumes: `listFilesRecursively(drive, rootFolderId, exclude?, include?, rename?: RenameRule[])` from Task 2
- Produces: `syncMapping(driveFolderId: string, deps: SyncMappingDeps, exclude?: ExcludeConfig, include?: IncludeConfig, rename?: RenameRule[])` — 5th parameter, optional

- [ ] **Step 1: Write the failing test**

Add the following test case to `src/sync/syncRunner.test.ts`, after the existing `"passes the include config through to listFilesRecursively"` test (before the closing `});` of the `describe` block):

```ts
  it("passes the rename config through to listFilesRecursively", async () => {
    const storage = new FakeStorageProvider();
    listFilesRecursively.mockResolvedValue([]);

    await syncMapping(
      "folder-id",
      fakeDeps(storage),
      undefined,
      undefined,
      [{ from: "photo", to: "cover" }],
    );

    expect(listFilesRecursively).toHaveBeenCalledWith(
      expect.anything(),
      "folder-id",
      undefined,
      undefined,
      [{ from: "photo", to: "cover" }],
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test syncRunner`
Expected: FAIL — `syncMapping` currently accepts only 4 parameters and never passes a 5th argument to `listFilesRecursively`, so the assertion on the mock call arguments fails (and passing a 5th argument at the call site is a TypeScript excess-argument error until the signature is updated).

- [ ] **Step 3: Implement the wiring**

In `src/sync/syncRunner.ts`, update the import to include `RenameRule`:

```ts
import type { ExcludeConfig, IncludeConfig, RenameRule } from "../config/schema.js";
```

Update the `syncMapping` function signature and its call to `listFilesRecursively`:

```ts
export async function syncMapping(
  driveFolderId: string,
  deps: SyncMappingDeps,
  exclude?: ExcludeConfig,
  include?: IncludeConfig,
  rename?: RenameRule[],
): Promise<SyncMappingResult> {
```

```ts
  const driveFiles = await listFilesRecursively(
    deps.drive,
    driveFolderId,
    exclude,
    include,
    rename,
  );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test syncRunner`
Expected: PASS (all `syncRunner.test.ts` cases, including the new one)

- [ ] **Step 5: Commit**

```bash
git add src/sync/syncRunner.ts src/sync/syncRunner.test.ts
git commit -m "feat: thread rename config through syncMapping to listFilesRecursively"
```

---

### Task 4: `cli.ts` から `config.rename` を配線

**Files:**
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `syncMapping(driveFolderId, deps, exclude?, include?, rename?: RenameRule[])` from Task 3, and `AppConfig.rename` from Task 1

- [ ] **Step 1: Update the syncMapping call site**

In `src/cli.ts`, update the `syncMapping` call inside the `for (const mapping of config.mappings)` loop to pass `config.rename` as the 5th argument:

```ts
    const result = await syncMapping(
      mapping.driveFolderId,
      {
        drive,
        docs,
        sheets,
        storage,
        dryRun: options.dryRun,
      },
      mapping.exclude,
      mapping.include,
      config.rename,
    );
```

- [ ] **Step 2: Verify the project builds and all tests pass**

Run: `pnpm build`
Expected: exits with code 0, no TypeScript errors

Run: `pnpm test`
Expected: all test suites pass

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat: wire config-level rename into the sync CLI"
```

---

### Task 5: README に `rename` の使い方を追記

**Files:**
- Modify: `README.md`

**Interfaces:**
- None (documentation only)

- [ ] **Step 1: Add a rename example and explanation**

In `README.md`, after the `include`の説明段落 (the paragraph starting with `` `include`も省略可能 `` and ending just before the `## 認証` heading), insert the following YAML example:

```yaml
rename:
  - from: "photo" # 拡張子なし → ベース名で一致判定(photo.jpg, photo.png 等にマッチ)
    to: "cover" # 拡張子なし → マッチしたファイルの元の拡張子を維持(例: cover.jpg)
  - from: "old_report.pdf" # 拡張子あり → ファイル名と完全一致
    to: "report_2024.pdf" # 拡張子あり → そのまま出力名として使用

mappings:
  - driveFolderId: "1AbCdEfGhIjKlMnOpQrStUvWxYz"
    destination:
      provider: gcs
      bucket: "my-bucket"
```

Then, right after that YAML example, add this explanatory paragraph:

```markdown
`rename`は省略可能。`exclude`/`include`とは異なり**mapping単位ではなくconfig全体に1つだけ**設定し、全mappingに共通で適用される。`from`に拡張子が含まれていない場合、対象ファイル名の拡張子を無視してベース名のみで一致判定する。`to`に拡張子が含まれていない場合、マッチしたファイルの元の拡張子を出力名に付与する。複数のルールに一致しうる場合は配列の先頭から順に評価し、最初にマッチしたルールのみが適用される。リネームはファイルのみが対象でフォルダ名には適用されない。また、`exclude`/`include`の判定は常にリネーム前の元のDriveファイル名に対して行われる。
```

- [ ] **Step 2: Verify formatting**

Run: `pnpm lint`
Expected: no new lint errors introduced by the README change (biome does not typically lint markdown content itself, but run this to confirm no other files were inadvertently affected)

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document rename config in README"
```

---

## Final Verification

- [ ] Run the full test suite: `pnpm test` — expect all tests passing
- [ ] Run the build: `pnpm build` — expect no TypeScript errors
- [ ] Run the linter: `pnpm lint` — expect no errors
