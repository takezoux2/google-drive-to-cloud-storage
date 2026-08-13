# Source Exclude Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each mapping in `config.yaml` exclude specific Drive files/folders from sync, by exact Drive ID or by a regex matched against the item's name.

**Architecture:** Add an optional `exclude` block to `mappingSchema` (`fileIds: string[]`, `namePatterns: string[]`, both optional, regex-validated at load time). Thread it through `syncMapping` into `listFilesRecursively`, which precompiles the rules once and applies them during its existing recursive walk: a matching folder is not recursed into (its whole subtree disappears from the sync), a matching file is kept in the result but reclassified as `conversionKind: "excluded"` — reusing the exact code path that already handles MIME-type exclusions (skip logging, stale-copy cleanup via `diffFiles`).

**Tech Stack:** TypeScript, zod (config validation), vitest (tests). No new dependencies.

## Global Constraints

- `exclude` is optional at every level; a `config.yaml` with no `exclude` blocks must parse and behave exactly as it does today (regression coverage required).
- Regex strings in `namePatterns` are validated at config-load time (`loadConfig`), not deferred to Drive-walk time — an invalid pattern must fail before any Drive API call.
- `namePatterns` match against the item's **name only** (not its relative path), using `RegExp.prototype.test()` (partial match; caller anchors with `^`/`$` for exact match).
- A single shared type (`ExcludeConfig`, exported from `src/config/schema.ts` via `z.infer`) is used everywhere `exclude` is passed around — do not introduce a second, differently-shaped exclude type in `types.ts`.
- Reference spec: `docs/superpowers/specs/2026-08-13-source-exclude-filters-design.md`.

---

### Task 1: Config schema — `exclude` field with regex validation

**Files:**
- Modify: `src/config/schema.ts`
- Test: `src/config/loadConfig.test.ts`

**Interfaces:**
- Produces: `excludeSchema` (zod schema), `ExcludeConfig` type (`{ fileIds?: string[]; namePatterns?: string[] }`), and `mappingSchema` gains an optional `exclude: excludeSchema.optional()` field. Later tasks import `ExcludeConfig` from `../config/schema.js`.

- [ ] **Step 1: Write the failing tests in `loadConfig.test.ts`**

Add these three `it` blocks inside the existing `describe("loadConfig", ...)` block, after the last existing test:

```ts
  it("parses a mapping with exclude fileIds and namePatterns", async () => {
    const configPath = path.join(dir, "exclude.yaml");
    await writeFile(
      configPath,
      `
mappings:
  - driveFolderId: "abc123"
    destination:
      provider: gcs
      bucket: "my-bucket"
    exclude:
      fileIds:
        - "excluded-id-1"
      namePatterns:
        - "^_.*"
        - "\\\\.tmp$"
`,
      "utf-8",
    );

    const config = await loadConfig(configPath);

    expect(config.mappings[0].exclude?.fileIds).toEqual(["excluded-id-1"]);
    expect(config.mappings[0].exclude?.namePatterns).toEqual([
      "^_.*",
      "\\.tmp$",
    ]);
  });

  it("parses a mapping with no exclude block (backward compatible)", async () => {
    const configPath = path.join(dir, "no-exclude.yaml");
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

    expect(config.mappings[0].exclude).toBeUndefined();
  });

  it("throws when a namePattern is not a valid regular expression", async () => {
    const configPath = path.join(dir, "bad-regex.yaml");
    await writeFile(
      configPath,
      `
mappings:
  - driveFolderId: "abc123"
    destination:
      provider: gcs
      bucket: "my-bucket"
    exclude:
      namePatterns:
        - "["
`,
      "utf-8",
    );

    await expect(loadConfig(configPath)).rejects.toThrow();
  });
```

Note: in a YAML double-quoted scalar, `\\.tmp$` is written as `\\\\.tmp$` inside the TS template literal (one level of TS-string escaping, one level of YAML-string escaping) so the parsed YAML value is the regex source `\.tmp$`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- loadConfig`
Expected: FAIL — `exclude` is not a recognized key yet (zod strips unknown keys by default, so `config.mappings[0].exclude` will be `undefined` for the first test's assertion `toEqual(["excluded-id-1"])`, and the bad-regex test will fail because nothing rejects it).

- [ ] **Step 3: Add `excludeSchema` and wire it into `mappingSchema`**

In `src/config/schema.ts`, add after `destinationSchema` and before `mappingSchema`:

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
```

Then update `mappingSchema`:

```ts
export const mappingSchema = z.object({
  driveFolderId: z.string().min(1),
  destination: destinationSchema,
  exclude: excludeSchema.optional(),
});
```

And add the exported type near the other `z.infer` exports at the bottom of the file:

```ts
export type ExcludeConfig = z.infer<typeof excludeSchema>;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- loadConfig`
Expected: PASS (all tests in `loadConfig.test.ts`, including the 3 new ones and the pre-existing ones — check for regressions).

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts src/config/loadConfig.test.ts
git commit -m "feat: add exclude schema (fileIds/namePatterns) to mapping config"
```

---

### Task 2: Exclusion logic in `listFilesRecursively`

**Files:**
- Modify: `src/drive/listFiles.ts`
- Test: `src/drive/listFiles.test.ts`

**Interfaces:**
- Consumes: `ExcludeConfig` type from `../config/schema.js` (produced in Task 1).
- Produces: `listFilesRecursively(drive, rootFolderId, exclude?: ExcludeConfig)`. Later tasks (`syncRunner.ts`) call this with an optional third argument.

- [ ] **Step 1: Write the failing tests in `listFiles.test.ts`**

Add these `it` blocks inside the existing `describe("listFilesRecursively", ...)` block, after the last existing test:

```ts
  it("excludes a file by fileId, marking it conversionKind excluded", async () => {
    const list = vi.fn().mockResolvedValue({
      data: {
        files: [
          {
            id: "file-excluded",
            name: "secret.txt",
            mimeType: "text/plain",
            modifiedTime: "2026-08-01T00:00:00.000Z",
            parents: ["root"],
          },
          {
            id: "file-kept",
            name: "keep.txt",
            mimeType: "text/plain",
            modifiedTime: "2026-08-01T00:00:00.000Z",
            parents: ["root"],
          },
        ],
      },
    });
    const drive = { files: { list } } as unknown as drive_v3.Drive;

    const result = await listFilesRecursively(drive, "root", {
      fileIds: ["file-excluded"],
    });

    expect(result).toHaveLength(2);
    expect(result.find((f) => f.id === "file-excluded")?.conversionKind).toBe(
      "excluded",
    );
    expect(result.find((f) => f.id === "file-kept")?.conversionKind).toBe(
      "copy",
    );
  });

  it("excludes a folder by fileId, skipping its entire subtree", async () => {
    const list = vi.fn().mockImplementation(({ q }: { q: string }) => {
      if (q.includes("'root'")) {
        return Promise.resolve({
          data: {
            files: [
              {
                id: "folder-excluded",
                name: "drafts",
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
              id: "file-inside-excluded",
              name: "draft.txt",
              mimeType: "text/plain",
              modifiedTime: "2026-08-01T00:00:00.000Z",
              parents: ["folder-excluded"],
            },
          ],
        },
      });
    });
    const drive = { files: { list } } as unknown as drive_v3.Drive;

    const result = await listFilesRecursively(drive, "root", {
      fileIds: ["folder-excluded"],
    });

    expect(result).toHaveLength(0);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("excludes files and folders matching a namePattern regex", async () => {
    const list = vi.fn().mockImplementation(({ q }: { q: string }) => {
      if (q.includes("'root'")) {
        return Promise.resolve({
          data: {
            files: [
              {
                id: "folder-underscore",
                name: "_ignored",
                mimeType: "application/vnd.google-apps.folder",
                modifiedTime: "2026-08-01T00:00:00.000Z",
                parents: ["root"],
              },
              {
                id: "file-tmp",
                name: "scratch.tmp",
                mimeType: "text/plain",
                modifiedTime: "2026-08-01T00:00:00.000Z",
                parents: ["root"],
              },
              {
                id: "file-kept",
                name: "keep.txt",
                mimeType: "text/plain",
                modifiedTime: "2026-08-01T00:00:00.000Z",
                parents: ["root"],
              },
            ],
          },
        });
      }
      return Promise.resolve({ data: { files: [] } });
    });
    const drive = { files: { list } } as unknown as drive_v3.Drive;

    const result = await listFilesRecursively(drive, "root", {
      namePatterns: ["^_", "\\.tmp$"],
    });

    expect(result).toHaveLength(2);
    expect(result.find((f) => f.id === "file-tmp")?.conversionKind).toBe(
      "excluded",
    );
    expect(result.find((f) => f.id === "file-kept")?.conversionKind).toBe(
      "copy",
    );
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("behaves exactly as before when exclude is omitted", async () => {
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

    expect(result).toHaveLength(1);
    expect(result[0].conversionKind).toBe("copy");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- listFiles`
Expected: FAIL — `listFilesRecursively` does not accept or apply a 3rd `exclude` argument yet, so excluded items are not filtered (e.g. `result` has length 2 instead of 0 in the folder-exclusion test).

- [ ] **Step 3: Implement exclusion logic in `listFiles.ts`**

Replace the full contents of `src/drive/listFiles.ts` with:

```ts
import type { drive_v3 } from "googleapis";
import type { ExcludeConfig } from "../config/schema.js";
import type { ClassifiedFile } from "../types.js";
import { classifyMimeType } from "./convert/classify.js";

const FOLDER_MIME = "application/vnd.google-apps.folder";

interface CompiledExclude {
  fileIds: Set<string>;
  namePatterns: RegExp[];
}

function compileExclude(exclude?: ExcludeConfig): CompiledExclude {
  return {
    fileIds: new Set(exclude?.fileIds ?? []),
    namePatterns: (exclude?.namePatterns ?? []).map((p) => new RegExp(p)),
  };
}

function isExcluded(compiled: CompiledExclude, id: string, name: string): boolean {
  if (compiled.fileIds.has(id)) return true;
  return compiled.namePatterns.some((re) => re.test(name));
}

export async function listFilesRecursively(
  drive: drive_v3.Drive,
  rootFolderId: string,
  exclude?: ExcludeConfig,
): Promise<ClassifiedFile[]> {
  const result: ClassifiedFile[] = [];
  const compiled = compileExclude(exclude);
  await walk(drive, rootFolderId, "", result, compiled);
  return result;
}

async function walk(
  drive: drive_v3.Drive,
  folderId: string,
  pathPrefix: string,
  result: ClassifiedFile[],
  exclude: CompiledExclude,
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
      const path = pathPrefix ? `${pathPrefix}/${file.name}` : file.name;
      if (file.mimeType === FOLDER_MIME) {
        if (isExcluded(exclude, file.id, file.name)) continue;
        await walk(drive, file.id, path, result, exclude);
      } else {
        result.push({
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          modifiedTime: file.modifiedTime,
          path,
          parents: file.parents ?? [],
          conversionKind: isExcluded(exclude, file.id, file.name)
            ? "excluded"
            : classifyMimeType(file.mimeType),
        });
      }
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
}
```

A folder match hits `continue` before recursing, so its whole subtree never gets listed. A file match still gets pushed into `result`, but with `conversionKind: "excluded"` instead of the classifier's result — this reuses the exact downstream handling (`syncRunner.ts`'s "Skipped: ... (excluded)" log and `diffFiles`'s stale-copy cleanup) that MIME-type exclusions already get.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- listFiles`
Expected: PASS (all tests in `listFiles.test.ts`, including the 4 new ones and the 2 pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add src/drive/listFiles.ts src/drive/listFiles.test.ts
git commit -m "feat: apply exclude fileIds/namePatterns during Drive tree walk"
```

---

### Task 3: Thread `exclude` through `syncMapping`

**Files:**
- Modify: `src/sync/syncRunner.ts`
- Test: `src/sync/syncRunner.test.ts`

**Interfaces:**
- Consumes: `listFilesRecursively(drive, rootFolderId, exclude?)` (Task 2), `ExcludeConfig` type from `../config/schema.js`.
- Produces: `syncMapping(driveFolderId: string, deps: SyncMappingDeps, exclude?: ExcludeConfig)`. Later task (`cli.ts`) calls this with `mapping.exclude` as the 3rd argument.

- [ ] **Step 1: Write the failing test in `syncRunner.test.ts`**

Add this `it` block inside the existing `describe("syncMapping", ...)` block, after the last existing test (before the closing `});` of the describe block):

```ts
  it("passes the exclude config through to listFilesRecursively", async () => {
    const storage = new FakeStorageProvider();
    listFilesRecursively.mockResolvedValue([]);

    await syncMapping("folder-id", fakeDeps(storage), {
      fileIds: ["skip-me"],
      namePatterns: ["^_"],
    });

    expect(listFilesRecursively).toHaveBeenCalledWith(
      expect.anything(),
      "folder-id",
      { fileIds: ["skip-me"], namePatterns: ["^_"] },
    );
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- syncRunner`
Expected: FAIL — `syncMapping` does not accept a 3rd argument yet, so `listFilesRecursively` is called with only 2 arguments (`expect.anything(), "folder-id"`) and the 3rd expected arg is missing.

- [ ] **Step 3: Add the `exclude` parameter in `syncRunner.ts`**

In `src/sync/syncRunner.ts`, update the imports and the `syncMapping` signature/call:

```ts
import type { docs_v1, drive_v3, sheets_v4 } from "googleapis";
import type { ExcludeConfig } from "../config/schema.js";
import { convertFile } from "../drive/convert/dispatch.js";
import { listFilesRecursively } from "../drive/listFiles.js";
import type { StorageProvider } from "../storage/StorageProvider.js";
import type { MetadataFileEntry, SyncMetadata } from "../types.js";
import { diffFiles } from "./diff.js";
import { readMetadata, writeMetadata } from "./metadata.js";
```

```ts
export async function syncMapping(
  driveFolderId: string,
  deps: SyncMappingDeps,
  exclude?: ExcludeConfig,
): Promise<SyncMappingResult> {
  const result: SyncMappingResult = { uploaded: [], deleted: [], failed: [] };

  const driveFiles = await listFilesRecursively(deps.drive, driveFolderId, exclude);
```

(only the function signature line and the `listFilesRecursively` call line change; the rest of the function body is untouched.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- syncRunner`
Expected: PASS (all tests in `syncRunner.test.ts`, including the new one and every pre-existing one — check for regressions).

- [ ] **Step 5: Commit**

```bash
git add src/sync/syncRunner.ts src/sync/syncRunner.test.ts
git commit -m "feat: thread exclude config through syncMapping to listFilesRecursively"
```

---

### Task 4: Wire `exclude` into the CLI and document it

**Files:**
- Modify: `src/cli.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `syncMapping(driveFolderId, deps, exclude?)` (Task 3), `mapping.exclude` (from `AppConfig`, Task 1).
- Produces: end-to-end behavior — no further tasks depend on this one.

- [ ] **Step 1: Pass `mapping.exclude` through in `cli.ts`**

In `src/cli.ts`, change the `syncMapping` call:

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
    );
```

- [ ] **Step 2: Run the full test suite and the build to verify nothing broke**

Run: `pnpm test`
Expected: PASS — every test file (including all tests touched in Tasks 1–3) passes.

Run: `pnpm build`
Expected: PASS — `tsc` reports no type errors (this is the only type-check for `cli.ts`, which has no dedicated test file).

- [ ] **Step 3: Document `exclude` in `README.md`**

In `README.md`, replace the `## 設定ファイル` section's YAML example (currently the block starting at `mappings:` under "`config.yaml`を作成する:") with:

```yaml
mappings:
  - driveFolderId: "1AbCdEfGhIjKlMnOpQrStUvWxYz"
    destination:
      provider: gcs
      bucket: "my-bucket"
      prefix: "backups/team-a"
    exclude:
      fileIds:
        - "1ExcludedFolderOrFileId"
      namePatterns:
        - "^_.*"
        - "\\.tmp$"

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

Then, right after the existing `provider: local`の場合は...` paragraph, add a new paragraph:

```markdown
`exclude`は省略可能。`fileIds`はDrive上のファイル/フォルダIDの完全一致リスト、`namePatterns`はファイル/フォルダ名(パスではなく名前のみ)にマッチする正規表現のリスト。フォルダがマッチした場合はその配下ごと同期対象から除外され、ファイルがマッチした場合はそのファイル単体が除外される(他のMIME種別による除外と同じ扱い)。
```

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts README.md
git commit -m "feat: wire exclude config into CLI and document it in README"
```

---

## Final verification

- [ ] Run `pnpm test` — all tests pass.
- [ ] Run `pnpm build` — no type errors.
- [ ] Run `pnpm lint` — no lint errors.
