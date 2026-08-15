# マッチしなかったrenameルールのログ出力 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同期実行が全mapping分終わった後、`config.rename`に定義されたルールのうち今回の実行で一度もファイルにマッチしなかったものを、まとめてログに出力する。

**Architecture:** `listFilesRecursively`(および内部の`applyRename`)が、マッチしたルールの`config.rename`配列上のインデックスを、呼び出し元から渡された共有`Set<number>`に記録する。`syncMapping`はこのSetをそのまま`listFilesRecursively`に受け渡す。`cli.ts`は全mappingループの前に1つの`Set<number>`を作成して全ての`syncMapping`呼び出しに共通で渡し、ループ終了後に`config.rename`の中でSetに含まれないインデックスのルールをログ出力する。

**Tech Stack:** TypeScript, vitest(テスト)

## Global Constraints

- 判定単位は実行全体(全mapping共通の1つの`Set<number>`で集計する)。mapping単位の個別報告はしない — 仕様: [2026-08-15-unmatched-rename-rule-logging-design.md](../specs/2026-08-15-unmatched-rename-rule-logging-design.md)
- ログ出力は全mappingのループが終わった後にまとめて行う
- 出力形式: `Rename rule not matched: from="{from}" to="{to}"`(1件につき1行)
- `--dry-run`でも通常実行でも同じように出力する
- `matchedRenameIndices`は省略可能な引数として追加する。省略時は記録を行わないだけで、既存の`listFilesRecursively`/`syncMapping`の呼び出し元・テストは変更なしで動作し続ける(後方互換性を壊さない)
- `config.rename`が未設定(0件)の場合は何もログ出力しない

---

## File Structure

- `src/drive/listFiles.ts` — `applyRename`と`listFilesRecursively`/`walk`に`matchedRenameIndices?: Set<number>`を追加し、マッチしたルールのインデックスを記録する
- `src/drive/listFiles.test.ts` — マッチ/非マッチのインデックス記録を検証するテストケースを追加
- `src/sync/syncRunner.ts` — `syncMapping`に`matchedRenameIndices?: Set<number>`を追加し、`listFilesRecursively`にそのまま渡す
- `src/sync/syncRunner.test.ts` — `matchedRenameIndices`が`listFilesRecursively`にそのまま渡されることを確認するテストケースを追加
- `src/cli.ts` — 全mapping共通の`Set<number>`を用意し、ループ後に未マッチルールをログ出力する
- `README.md` — `rename`セクションに、マッチしなかったルールがログ出力される旨を追記

---

### Task 1: `listFiles.ts`でマッチしたルールのインデックスを記録する

**Files:**
- Modify: `src/drive/listFiles.ts`
- Test: `src/drive/listFiles.test.ts`

**Interfaces:**
- Produces: `listFilesRecursively(drive, rootFolderId, exclude?, include?, rename?, matchedRenameIndices?: Set<number>)` — 6th parameter, optional。渡された場合、マッチした`rename`配列上のインデックスがそのSetに追加される

- [ ] **Step 1: Write the failing tests**

Add the following test cases to `src/drive/listFiles.test.ts`, inside the existing `describe("listFilesRecursively", ...)` block (after the last existing `it` — `"behaves exactly as before when rename is omitted"` — before the closing `});`):

```ts
  it("records the matched rule's index in matchedRenameIndices", async () => {
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
    const matchedRenameIndices = new Set<number>();

    await listFilesRecursively(
      drive,
      "root",
      undefined,
      undefined,
      [
        { from: "old_report.pdf", to: "report_2024.pdf" },
        { from: "photo", to: "cover" },
      ],
      matchedRenameIndices,
    );

    expect(matchedRenameIndices).toEqual(new Set([1]));
  });

  it("does not record an index for a rule that never matches any file", async () => {
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
    const matchedRenameIndices = new Set<number>();

    await listFilesRecursively(
      drive,
      "root",
      undefined,
      undefined,
      [
        { from: "photo", to: "cover" },
        { from: "unused_rule.pdf", to: "x.pdf" },
      ],
      matchedRenameIndices,
    );

    expect(matchedRenameIndices).toEqual(new Set([0]));
    expect(matchedRenameIndices.has(1)).toBe(false);
  });

  it("records indices for multiple matching rules across multiple files", async () => {
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
    const matchedRenameIndices = new Set<number>();

    await listFilesRecursively(
      drive,
      "root",
      undefined,
      undefined,
      [
        { from: "photo", to: "cover" },
        { from: "old_report.pdf", to: "report_2024.pdf" },
      ],
      matchedRenameIndices,
    );

    expect(matchedRenameIndices).toEqual(new Set([0, 1]));
  });

  it("works without matchedRenameIndices provided (optional, no crash)", async () => {
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

    expect(result[0].path).toBe("cover.jpg");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test listFiles`
Expected: FAIL — `listFilesRecursively` currently accepts only 5 parameters and never records matched indices, so `matchedRenameIndices` stays an empty Set after each call and every `toEqual`/`.has` assertion against a populated Set fails. Passing a 6th argument at the call site is also a TypeScript excess-argument error until the signature is updated.

- [ ] **Step 3: Implement the index tracking**

In `src/drive/listFiles.ts`, replace the `applyRename` function:

```ts
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
```

with:

```ts
function applyRename(
  rules: CompiledRenameRule[],
  name: string,
  matchedIndices?: Set<number>,
): string {
  const { base, ext } = splitExt(name);
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    const matched = rule.fromExt ? name === rule.from : base === rule.from;
    if (matched) {
      matchedIndices?.add(i);
      return rule.toExt ? rule.to : `${rule.to}${ext}`;
    }
  }
  return name;
}
```

Replace the `listFilesRecursively` function:

```ts
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
```

with:

```ts
export async function listFilesRecursively(
  drive: drive_v3.Drive,
  rootFolderId: string,
  exclude?: ExcludeConfig,
  include?: IncludeConfig,
  rename?: RenameRule[],
  matchedRenameIndices?: Set<number>,
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
    matchedRenameIndices,
  );
  return result;
}
```

Replace the `walk` function:

```ts
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

with:

```ts
async function walk(
  drive: drive_v3.Drive,
  folderId: string,
  pathPrefix: string,
  result: ClassifiedFile[],
  exclude: CompiledExclude,
  include: CompiledInclude,
  rename: CompiledRenameRule[],
  matchedRenameIndices?: Set<number>,
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
        await walk(
          drive,
          file.id,
          path,
          result,
          exclude,
          include,
          rename,
          matchedRenameIndices,
        );
      } else {
        const outputName = applyRename(rename, file.name, matchedRenameIndices);
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
Expected: PASS (all `listFiles.test.ts` cases, including the 4 new ones)

- [ ] **Step 5: Commit**

```bash
git add src/drive/listFiles.ts src/drive/listFiles.test.ts
git commit -m "feat: track matched rename rule indices during Drive tree walk"
```

---

### Task 2: `syncRunner.ts`に`matchedRenameIndices`を配線

**Files:**
- Modify: `src/sync/syncRunner.ts`
- Test: `src/sync/syncRunner.test.ts`

**Interfaces:**
- Consumes: `listFilesRecursively(drive, rootFolderId, exclude?, include?, rename?, matchedRenameIndices?: Set<number>)` from Task 1
- Produces: `syncMapping(driveFolderId, deps, exclude?, include?, rename?, matchedRenameIndices?: Set<number>)` — 6th parameter, optional

- [ ] **Step 1: Write the failing test**

Add the following test case to `src/sync/syncRunner.test.ts`, after the existing `"uploads a file to the correct destination key when listFilesRecursively already returned a renamed path"` test (before the closing `});` of the `describe` block):

```ts
  it("passes matchedRenameIndices through to listFilesRecursively", async () => {
    const storage = new FakeStorageProvider();
    listFilesRecursively.mockResolvedValue([]);
    const matchedRenameIndices = new Set<number>();

    await syncMapping(
      "folder-id",
      fakeDeps(storage),
      undefined,
      undefined,
      [{ from: "photo", to: "cover" }],
      matchedRenameIndices,
    );

    expect(listFilesRecursively).toHaveBeenCalledWith(
      expect.anything(),
      "folder-id",
      undefined,
      undefined,
      [{ from: "photo", to: "cover" }],
      matchedRenameIndices,
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test syncRunner`
Expected: FAIL — `syncMapping` currently accepts only 5 parameters and never passes a 6th argument to `listFilesRecursively`, so the assertion on the mock call arguments fails (and passing a 6th argument at the call site is a TypeScript excess-argument error until the signature is updated).

- [ ] **Step 3: Implement the wiring**

In `src/sync/syncRunner.ts`, replace the `syncMapping` function signature:

```ts
export async function syncMapping(
  driveFolderId: string,
  deps: SyncMappingDeps,
  exclude?: ExcludeConfig,
  include?: IncludeConfig,
  rename?: RenameRule[],
): Promise<SyncMappingResult> {
```

with:

```ts
export async function syncMapping(
  driveFolderId: string,
  deps: SyncMappingDeps,
  exclude?: ExcludeConfig,
  include?: IncludeConfig,
  rename?: RenameRule[],
  matchedRenameIndices?: Set<number>,
): Promise<SyncMappingResult> {
```

Replace the call to `listFilesRecursively`:

```ts
  const driveFiles = await listFilesRecursively(
    deps.drive,
    driveFolderId,
    exclude,
    include,
    rename,
  );
```

with:

```ts
  const driveFiles = await listFilesRecursively(
    deps.drive,
    driveFolderId,
    exclude,
    include,
    rename,
    matchedRenameIndices,
  );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test syncRunner`
Expected: PASS (all `syncRunner.test.ts` cases, including the new one)

- [ ] **Step 5: Commit**

```bash
git add src/sync/syncRunner.ts src/sync/syncRunner.test.ts
git commit -m "feat: thread matchedRenameIndices through syncMapping to listFilesRecursively"
```

---

### Task 3: `cli.ts`で未マッチルールをログ出力し、READMEに追記

**Files:**
- Modify: `src/cli.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `syncMapping(driveFolderId, deps, exclude?, include?, rename?, matchedRenameIndices?: Set<number>)` from Task 2, and `AppConfig.rename` (`RenameRule[] | undefined`)

- [ ] **Step 1: Create a shared Set and pass it to every syncMapping call**

In `src/cli.ts`, replace:

```ts
  let hasFailure = false;
  for (const mapping of config.mappings) {
    const storage = createStorageProvider(mapping.destination);
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

    console.log(
      `[${mapping.driveFolderId}] uploaded=${result.uploaded.length} deleted=${result.deleted.length} excluded=${result.excluded.length} failed=${result.failed.length}`,
    );
    for (const failure of result.failed) {
      console.error(`  FAILED ${failure.sourcePath}: ${failure.error}`);
      hasFailure = true;
    }
  }

  if (hasFailure) {
    process.exitCode = 1;
  }
```

with:

```ts
  let hasFailure = false;
  const matchedRenameIndices = new Set<number>();
  for (const mapping of config.mappings) {
    const storage = createStorageProvider(mapping.destination);
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
      matchedRenameIndices,
    );

    console.log(
      `[${mapping.driveFolderId}] uploaded=${result.uploaded.length} deleted=${result.deleted.length} excluded=${result.excluded.length} failed=${result.failed.length}`,
    );
    for (const failure of result.failed) {
      console.error(`  FAILED ${failure.sourcePath}: ${failure.error}`);
      hasFailure = true;
    }
  }

  for (const [i, rule] of (config.rename ?? []).entries()) {
    if (!matchedRenameIndices.has(i)) {
      console.log(
        `Rename rule not matched: from="${rule.from}" to="${rule.to}"`,
      );
    }
  }

  if (hasFailure) {
    process.exitCode = 1;
  }
```

- [ ] **Step 2: Verify the project builds and all tests pass**

Run: `pnpm build`
Expected: exits with code 0, no TypeScript errors

Run: `pnpm test`
Expected: all test suites pass

- [ ] **Step 3: Document the new logging behavior in README.md**

In `README.md`, right after the existing paragraph that begins with `` 拡張子の判定はNode.jsの`path.extname()`の仕様にそのまま従うため `` (the last paragraph of the `rename` section, immediately before the `## 認証` heading), add a new paragraph:

```markdown
実行が全mapping分終わった後、`rename`に定義したルールのうち今回の実行で一度もファイルにマッチしなかったものは、`Rename rule not matched: from="..." to="..."`という形でログに出力される(`--dry-run`でも出力される)。いずれかのmappingでマッチすればそのルールは「マッチした」扱いになり、mapping単位では報告されない。
```

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts README.md
git commit -m "feat: log rename rules that never matched during the sync run"
```

---

## Final Verification

- [ ] Run the full test suite: `pnpm test` — expect all tests passing
- [ ] Run the build: `pnpm build` — expect no TypeScript errors
- [ ] Run the linter: `pnpm lint` — expect no errors
