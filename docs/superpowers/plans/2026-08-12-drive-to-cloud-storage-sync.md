# Google Drive → Cloud Storage 同期CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Google Driveの指定フォルダ配下を、ファイル種別に応じて変換しながらGCS/S3へ差分同期するTypeScript製CLIコマンドを実装する。

**Architecture:** `drive/`(Drive/Docs/Sheets取得と変換)、`storage/`(GCS/S3への抽象化されたアップロード・削除・ダウンロード)、`sync/`(差分検出とオーケストレーション)、`config/`(YAML設定の読み込み・検証)を疎結合なモジュールとして実装し、`cli.ts`から`commander`で組み立てる。各モジュールは依存を注入可能にし、外部SDK(googleapis, @google-cloud/storage, @aws-sdk/client-s3, sharp, docs-markdown)をモックしてvitestで単体テストする。

**Tech Stack:** TypeScript(ESM, Node >=20), pnpm, biome, vitest, commander, zod, yaml, googleapis, google-auth-library, docs-markdown, sharp, @google-cloud/storage, @aws-sdk/client-s3

## Global Constraints

- パッケージ管理・ビルドは`pnpm`を使用する
- Lintは`biome`を使用する(`pnpm lint` / `pnpm lint:fix`)
- テストは`vitest`を使用する(`pnpm test`)
- モジュール形式はESM(`"type": "module"`)、TypeScriptは`strict: true`
- Google認証はADC(Application Default Credentials)、AWS認証はデフォルト認証チェーンを使用し、設定ファイルに認証情報を書かない
- 差分同期はDrive上のパス(`sourcePath`)と`modifiedTime`をキーに行う。詳細は仕様書 `docs/superpowers/specs/2026-08-12-drive-to-cloud-storage-sync-design.md` を参照
- コードにコメントは付けない(WHYが非自明な場合のみ最小限の一行コメント)

---

### Task 1: プロジェクト初期化とツール設定

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `biome.json`
- Create: `.gitignore`
- Create: `src/index.ts` (仮のプレースホルダーではなく、後続タスクで置き換わる最小のエントリ確認用ファイル)

**Interfaces:**
- Consumes: なし
- Produces: `pnpm build` / `pnpm test` / `pnpm lint` が実行可能なプロジェクト基盤

- [ ] **Step 1: Gitリポジトリ初期化**

```bash
git init
```

- [ ] **Step 2: pnpmプロジェクト初期化**

```bash
pnpm init
```

- [ ] **Step 3: 依存パッケージを追加**

```bash
pnpm add commander yaml zod googleapis google-auth-library docs-markdown sharp @google-cloud/storage @aws-sdk/client-s3
pnpm add -D typescript vitest @types/node @biomejs/biome
```

- [ ] **Step 4: `tsconfig.json`を作成**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false,
    "sourceMap": false,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 5: `package.json`の`type`とスクリプト、binを設定**

`package.json`を開き、以下のフィールドを追加・修正する(`pnpm init`が生成した`name`/`version`等は維持):

```json
{
  "type": "module",
  "bin": {
    "gdrive-to-cloud-storage": "dist/cli.js"
  },
  "main": "dist/cli.js",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "format": "biome format --write ."
  }
}
```

- [ ] **Step 6: `vitest.config.ts`を作成**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 7: biome設定を生成し編集**

```bash
pnpm exec biome init
```

生成された`biome.json`を以下の内容に置き換える(スキーマURLは生成されたファイルの`$schema`値をそのまま維持すること):

```json
{
  "$schema": "./node_modules/@biomejs/biome/configuration_schema.json",
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2
  },
  "files": {
    "ignore": ["dist/**", "node_modules/**"]
  }
}
```

- [ ] **Step 8: `.gitignore`を作成**

```
node_modules/
dist/
*.log
```

- [ ] **Step 9: 動作確認用の最小エントリを作成**

`src/index.ts`:

```ts
export const VERSION = "0.1.0";
```

- [ ] **Step 10: ビルド・Lintが通ることを確認**

```bash
pnpm build
pnpm lint
```

Expected: どちらもエラーなく終了する

- [ ] **Step 11: コミット**

```bash
git add package.json pnpm-lock.yaml tsconfig.json vitest.config.ts biome.json .gitignore src/index.ts docs
git commit -m "chore: scaffold TypeScript CLI project with pnpm, biome, vitest"
```

---

### Task 2: 共有型定義と設定ファイルの読み込み

**Files:**
- Create: `src/types.ts`
- Create: `src/config/schema.ts`
- Create: `src/config/loadConfig.ts`
- Test: `src/config/loadConfig.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `ConversionKind`, `DriveFileInfo`, `ClassifiedFile`, `MetadataFileEntry`, `SyncMetadata`, `DiffResult`(`src/types.ts`)
  - `configSchema`, `AppConfig`, `Mapping`, `Destination`(`src/config/schema.ts`)
  - `loadConfig(path: string): Promise<AppConfig>`(`src/config/loadConfig.ts`)

- [ ] **Step 1: 共有型を定義**

`src/types.ts`:

```ts
export type ConversionKind =
  | "google-doc-to-markdown"
  | "google-sheet-to-csv"
  | "image-convert-to-jpeg"
  | "copy"
  | "excluded";

export interface DriveFileInfo {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  path: string;
  parents: string[];
}

export interface ClassifiedFile extends DriveFileInfo {
  conversionKind: ConversionKind;
}

export interface MetadataFileEntry {
  path: string;
  sourcePath: string;
  originUrl: string;
  linkUrl: string;
  modifiedTime: string;
}

export interface SyncMetadata {
  files: MetadataFileEntry[];
  updatedAt: string;
}

export interface DiffResult {
  toUpload: ClassifiedFile[];
  toDelete: MetadataFileEntry[];
}
```

- [ ] **Step 2: 設定スキーマを定義**

`src/config/schema.ts`:

```ts
import { z } from "zod";

export const destinationSchema = z.object({
  provider: z.enum(["gcs", "s3"]),
  bucket: z.string().min(1),
  prefix: z.string().optional(),
  region: z.string().optional(),
});

export const mappingSchema = z.object({
  driveFolderId: z.string().min(1),
  destination: destinationSchema,
});

export const configSchema = z.object({
  mappings: z.array(mappingSchema).min(1),
  concurrency: z.number().int().positive().optional(),
});

export type Destination = z.infer<typeof destinationSchema>;
export type Mapping = z.infer<typeof mappingSchema>;
export type AppConfig = z.infer<typeof configSchema>;
```

- [ ] **Step 3: 失敗するテストを書く**

`src/config/loadConfig.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "./loadConfig.js";

describe("loadConfig", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "gdrive-sync-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("parses a valid config file", async () => {
    const configPath = path.join(dir, "config.yaml");
    await writeFile(
      configPath,
      `
mappings:
  - driveFolderId: "abc123"
    destination:
      provider: gcs
      bucket: "my-bucket"
      prefix: "backups"
concurrency: 4
`,
      "utf-8"
    );

    const config = await loadConfig(configPath);

    expect(config.mappings).toHaveLength(1);
    expect(config.mappings[0].driveFolderId).toBe("abc123");
    expect(config.mappings[0].destination.provider).toBe("gcs");
    expect(config.concurrency).toBe(4);
  });

  it("throws when mappings is missing", async () => {
    const configPath = path.join(dir, "invalid.yaml");
    await writeFile(configPath, "concurrency: 2\n", "utf-8");

    await expect(loadConfig(configPath)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
pnpm test -- src/config/loadConfig.test.ts
```

Expected: FAIL(`loadConfig.js`が存在しないためモジュール解決エラー)

- [ ] **Step 3: `loadConfig`を実装**

`src/config/loadConfig.ts`:

```ts
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { type AppConfig, configSchema } from "./schema.js";

export async function loadConfig(filePath: string): Promise<AppConfig> {
  const raw = await readFile(filePath, "utf-8");
  const data = parse(raw);
  return configSchema.parse(data);
}
```

- [ ] **Step 4: テストが通ることを確認**

```bash
pnpm test -- src/config/loadConfig.test.ts
```

Expected: PASS(2 tests)

- [ ] **Step 5: コミット**

```bash
git add src/types.ts src/config
git commit -m "feat: add shared types and config file loading"
```

---

### Task 3: ファイル種別の判定(classify)

**Files:**
- Create: `src/drive/convert/classify.ts`
- Test: `src/drive/convert/classify.test.ts`

**Interfaces:**
- Consumes: `ConversionKind`(`src/types.ts`)
- Produces: `classifyMimeType(mimeType: string): ConversionKind`

- [ ] **Step 1: 失敗するテストを書く**

`src/drive/convert/classify.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { classifyMimeType } from "./classify.js";

describe("classifyMimeType", () => {
  it("classifies Google Docs as markdown conversion", () => {
    expect(classifyMimeType("application/vnd.google-apps.document")).toBe(
      "google-doc-to-markdown"
    );
  });

  it("classifies Google Sheets as csv conversion", () => {
    expect(classifyMimeType("application/vnd.google-apps.spreadsheet")).toBe(
      "google-sheet-to-csv"
    );
  });

  it("excludes Google Slides", () => {
    expect(classifyMimeType("application/vnd.google-apps.presentation")).toBe(
      "excluded"
    );
  });

  it("copies pdf as-is", () => {
    expect(classifyMimeType("application/pdf")).toBe("copy");
  });

  it("copies plain text as-is", () => {
    expect(classifyMimeType("text/plain")).toBe("copy");
  });

  it("copies png as-is", () => {
    expect(classifyMimeType("image/png")).toBe("copy");
  });

  it("converts webp to jpeg", () => {
    expect(classifyMimeType("image/webp")).toBe("image-convert-to-jpeg");
  });

  it("converts heic to jpeg", () => {
    expect(classifyMimeType("image/heic")).toBe("image-convert-to-jpeg");
  });

  it("excludes unknown types", () => {
    expect(classifyMimeType("application/octet-stream")).toBe("excluded");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
pnpm test -- src/drive/convert/classify.test.ts
```

Expected: FAIL(モジュールが存在しない)

- [ ] **Step 3: `classifyMimeType`を実装**

`src/drive/convert/classify.ts`:

```ts
import type { ConversionKind } from "../../types.js";

const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const GOOGLE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const GOOGLE_SLIDES_MIME = "application/vnd.google-apps.presentation";

const CONVERT_TO_JPEG_MIME_TYPES = new Set(["image/webp", "image/heic"]);

const COPY_AS_IS_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/xml",
  "application/xml",
  "application/json",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/svg+xml",
]);

export function classifyMimeType(mimeType: string): ConversionKind {
  if (mimeType === GOOGLE_DOC_MIME) return "google-doc-to-markdown";
  if (mimeType === GOOGLE_SHEET_MIME) return "google-sheet-to-csv";
  if (mimeType === GOOGLE_SLIDES_MIME) return "excluded";
  if (CONVERT_TO_JPEG_MIME_TYPES.has(mimeType)) return "image-convert-to-jpeg";
  if (COPY_AS_IS_MIME_TYPES.has(mimeType)) return "copy";
  return "excluded";
}
```

- [ ] **Step 4: テストが通ることを確認**

```bash
pnpm test -- src/drive/convert/classify.test.ts
```

Expected: PASS(9 tests)

- [ ] **Step 5: コミット**

```bash
git add src/drive/convert/classify.ts src/drive/convert/classify.test.ts
git commit -m "feat: classify Drive mime types into conversion kinds"
```

---

### Task 4: StorageProviderインターフェースとメタデータ読み書き

**Files:**
- Create: `src/storage/StorageProvider.ts`
- Create: `src/sync/metadata.ts`
- Test: `src/sync/metadata.test.ts`

**Interfaces:**
- Consumes: `SyncMetadata`(`src/types.ts`)
- Produces:
  - `interface StorageProvider { upload(params: UploadParams): Promise<void>; delete(key: string): Promise<void>; download(key: string): Promise<Buffer | undefined>; }`(`src/storage/StorageProvider.ts`)
  - `readMetadata(storage: StorageProvider): Promise<SyncMetadata>`
  - `writeMetadata(storage: StorageProvider, metadata: SyncMetadata): Promise<void>`

- [ ] **Step 1: `StorageProvider`インターフェースを定義**

`src/storage/StorageProvider.ts`:

```ts
export interface UploadParams {
  key: string;
  data: Buffer;
  contentType: string;
}

export interface StorageProvider {
  upload(params: UploadParams): Promise<void>;
  delete(key: string): Promise<void>;
  download(key: string): Promise<Buffer | undefined>;
}
```

- [ ] **Step 2: 失敗するテストを書く**

`src/sync/metadata.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { StorageProvider, UploadParams } from "../storage/StorageProvider.js";
import type { SyncMetadata } from "../types.js";
import { readMetadata, writeMetadata } from "./metadata.js";

class FakeStorageProvider implements StorageProvider {
  private store = new Map<string, Buffer>();
  uploadCalls: UploadParams[] = [];

  async upload(params: UploadParams): Promise<void> {
    this.uploadCalls.push(params);
    this.store.set(params.key, params.data);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async download(key: string): Promise<Buffer | undefined> {
    return this.store.get(key);
  }
}

describe("metadata", () => {
  it("returns an empty metadata when no file exists", async () => {
    const storage = new FakeStorageProvider();

    const metadata = await readMetadata(storage);

    expect(metadata.files).toEqual([]);
  });

  it("writes and reads back metadata.json", async () => {
    const storage = new FakeStorageProvider();
    const metadata: SyncMetadata = {
      files: [
        {
          path: "docs/report.md",
          sourcePath: "docs/report",
          originUrl: "https://drive.google.com/open?id=abc",
          linkUrl: "https://drive.google.com/open?id=abc",
          modifiedTime: "2026-08-01T00:00:00.000Z",
        },
      ],
      updatedAt: "2026-08-12T00:00:00.000Z",
    };

    await writeMetadata(storage, metadata);
    const result = await readMetadata(storage);

    expect(result).toEqual(metadata);
    expect(storage.uploadCalls[0].key).toBe("metadata.json");
    expect(storage.uploadCalls[0].contentType).toBe("application/json");
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

```bash
pnpm test -- src/sync/metadata.test.ts
```

Expected: FAIL(`metadata.js`が存在しない)

- [ ] **Step 4: `metadata.ts`を実装**

`src/sync/metadata.ts`:

```ts
import type { StorageProvider } from "../storage/StorageProvider.js";
import type { SyncMetadata } from "../types.js";

const METADATA_KEY = "metadata.json";

export async function readMetadata(storage: StorageProvider): Promise<SyncMetadata> {
  const buf = await storage.download(METADATA_KEY);
  if (!buf) {
    return { files: [], updatedAt: new Date(0).toISOString() };
  }
  return JSON.parse(buf.toString("utf-8")) as SyncMetadata;
}

export async function writeMetadata(
  storage: StorageProvider,
  metadata: SyncMetadata
): Promise<void> {
  const data = Buffer.from(JSON.stringify(metadata, null, 2), "utf-8");
  await storage.upload({ key: METADATA_KEY, data, contentType: "application/json" });
}
```

- [ ] **Step 5: テストが通ることを確認**

```bash
pnpm test -- src/sync/metadata.test.ts
```

Expected: PASS(2 tests)

- [ ] **Step 6: コミット**

```bash
git add src/storage/StorageProvider.ts src/sync/metadata.ts src/sync/metadata.test.ts
git commit -m "feat: add StorageProvider interface and metadata.json read/write"
```

---

### Task 5: 差分検出(diff)

**Files:**
- Create: `src/sync/diff.ts`
- Test: `src/sync/diff.test.ts`

**Interfaces:**
- Consumes: `ClassifiedFile`, `SyncMetadata`, `MetadataFileEntry`, `DiffResult`(`src/types.ts`)
- Produces: `diffFiles(driveFiles: ClassifiedFile[], metadata: SyncMetadata): DiffResult`

- [ ] **Step 1: 失敗するテストを書く**

`src/sync/diff.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ClassifiedFile, SyncMetadata } from "../types.js";
import { diffFiles } from "./diff.js";

function makeFile(overrides: Partial<ClassifiedFile>): ClassifiedFile {
  return {
    id: "id-1",
    name: "file.txt",
    mimeType: "text/plain",
    modifiedTime: "2026-08-01T00:00:00.000Z",
    path: "file.txt",
    parents: [],
    conversionKind: "copy",
    ...overrides,
  };
}

describe("diffFiles", () => {
  it("marks a new file as toUpload", () => {
    const driveFiles = [makeFile({ path: "new.txt" })];
    const metadata: SyncMetadata = { files: [], updatedAt: "2026-08-01T00:00:00.000Z" };

    const result = diffFiles(driveFiles, metadata);

    expect(result.toUpload).toHaveLength(1);
    expect(result.toUpload[0].path).toBe("new.txt");
    expect(result.toDelete).toHaveLength(0);
  });

  it("marks an updated file (newer modifiedTime) as toUpload", () => {
    const driveFiles = [
      makeFile({ path: "existing.txt", modifiedTime: "2026-08-10T00:00:00.000Z" }),
    ];
    const metadata: SyncMetadata = {
      files: [
        {
          path: "existing.txt",
          sourcePath: "existing.txt",
          originUrl: "https://drive.google.com/open?id=id-1",
          linkUrl: "https://drive.google.com/open?id=id-1",
          modifiedTime: "2026-08-01T00:00:00.000Z",
        },
      ],
      updatedAt: "2026-08-01T00:00:00.000Z",
    };

    const result = diffFiles(driveFiles, metadata);

    expect(result.toUpload).toHaveLength(1);
  });

  it("does not re-upload an unchanged file", () => {
    const driveFiles = [
      makeFile({ path: "same.txt", modifiedTime: "2026-08-01T00:00:00.000Z" }),
    ];
    const metadata: SyncMetadata = {
      files: [
        {
          path: "same.txt",
          sourcePath: "same.txt",
          originUrl: "https://drive.google.com/open?id=id-1",
          linkUrl: "https://drive.google.com/open?id=id-1",
          modifiedTime: "2026-08-01T00:00:00.000Z",
        },
      ],
      updatedAt: "2026-08-01T00:00:00.000Z",
    };

    const result = diffFiles(driveFiles, metadata);

    expect(result.toUpload).toHaveLength(0);
  });

  it("marks a metadata entry as toDelete when its source is gone from Drive", () => {
    const driveFiles: ClassifiedFile[] = [];
    const metadata: SyncMetadata = {
      files: [
        {
          path: "removed.txt",
          sourcePath: "removed.txt",
          originUrl: "https://drive.google.com/open?id=id-2",
          linkUrl: "https://drive.google.com/open?id=id-2",
          modifiedTime: "2026-08-01T00:00:00.000Z",
        },
      ],
      updatedAt: "2026-08-01T00:00:00.000Z",
    };

    const result = diffFiles(driveFiles, metadata);

    expect(result.toDelete).toHaveLength(1);
    expect(result.toDelete[0].path).toBe("removed.txt");
  });

  it("excludes files classified as excluded from upload and treats them as absent for deletion", () => {
    const driveFiles = [makeFile({ path: "slides.gslides", conversionKind: "excluded" })];
    const metadata: SyncMetadata = { files: [], updatedAt: "2026-08-01T00:00:00.000Z" };

    const result = diffFiles(driveFiles, metadata);

    expect(result.toUpload).toHaveLength(0);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
pnpm test -- src/sync/diff.test.ts
```

Expected: FAIL(モジュールが存在しない)

- [ ] **Step 3: `diffFiles`を実装**

`src/sync/diff.ts`:

```ts
import type { ClassifiedFile, DiffResult, SyncMetadata } from "../types.js";

export function diffFiles(driveFiles: ClassifiedFile[], metadata: SyncMetadata): DiffResult {
  const activeFiles = driveFiles.filter((f) => f.conversionKind !== "excluded");

  const latestModifiedBySourcePath = new Map<string, string>();
  for (const entry of metadata.files) {
    const current = latestModifiedBySourcePath.get(entry.sourcePath);
    if (!current || new Date(entry.modifiedTime).getTime() > new Date(current).getTime()) {
      latestModifiedBySourcePath.set(entry.sourcePath, entry.modifiedTime);
    }
  }

  const toUpload = activeFiles.filter((f) => {
    const existingModifiedTime = latestModifiedBySourcePath.get(f.path);
    if (!existingModifiedTime) return true;
    return new Date(f.modifiedTime).getTime() > new Date(existingModifiedTime).getTime();
  });

  const activeSourcePaths = new Set(activeFiles.map((f) => f.path));
  const toDelete = metadata.files.filter((entry) => !activeSourcePaths.has(entry.sourcePath));

  return { toUpload, toDelete };
}
```

- [ ] **Step 4: テストが通ることを確認**

```bash
pnpm test -- src/sync/diff.test.ts
```

Expected: PASS(5 tests)

- [ ] **Step 5: コミット**

```bash
git add src/sync/diff.ts src/sync/diff.test.ts
git commit -m "feat: add drive/metadata diff logic"
```

---

### Task 6: Googleスプレッドシート→CSV変換

**Files:**
- Create: `src/drive/convert/sheets.ts`
- Test: `src/drive/convert/sheets.test.ts`

**Interfaces:**
- Consumes: なし(`sheets_v4.Sheets`は`googleapis`から取得する型)
- Produces:
  - `rowsToCsv(rows: string[][]): string`
  - `convertSpreadsheetToCsvFiles(sheetsClient: sheets_v4.Sheets, spreadsheetId: string): Promise<Map<string, string>>`

- [ ] **Step 1: 失敗するテストを書く**

`src/drive/convert/sheets.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { sheets_v4 } from "googleapis";
import { convertSpreadsheetToCsvFiles, rowsToCsv } from "./sheets.js";

describe("rowsToCsv", () => {
  it("joins simple rows with commas and CRLF", () => {
    expect(rowsToCsv([["a", "b"], ["c", "d"]])).toBe("a,b\r\nc,d");
  });

  it("quotes fields containing commas, quotes, or newlines", () => {
    expect(rowsToCsv([['a,b', 'say "hi"', "line1\nline2"]])).toBe(
      '"a,b","say ""hi""","line1\nline2"'
    );
  });
});

describe("convertSpreadsheetToCsvFiles", () => {
  it("fetches every sheet and converts its values to CSV", async () => {
    const sheetsClient = {
      spreadsheets: {
        get: vi.fn().mockResolvedValue({
          data: {
            sheets: [
              { properties: { title: "Sheet1" } },
              { properties: { title: "Sheet 2" } },
            ],
          },
        }),
        values: {
          get: vi.fn().mockImplementation(({ range }: { range: string }) => {
            if (range === "'Sheet1'") {
              return Promise.resolve({ data: { values: [["a", "b"]] } });
            }
            return Promise.resolve({ data: { values: [["c", "d"]] } });
          }),
        },
      },
    } as unknown as sheets_v4.Sheets;

    const result = await convertSpreadsheetToCsvFiles(sheetsClient, "sheet-id");

    expect(result.get("Sheet1")).toBe("a,b");
    expect(result.get("Sheet 2")).toBe("c,d");
    expect(sheetsClient.spreadsheets.values.get).toHaveBeenCalledWith(
      expect.objectContaining({ spreadsheetId: "sheet-id", range: "'Sheet 2'" })
    );
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
pnpm test -- src/drive/convert/sheets.test.ts
```

Expected: FAIL(モジュールが存在しない)

- [ ] **Step 3: `sheets.ts`を実装**

`src/drive/convert/sheets.ts`:

```ts
import type { sheets_v4 } from "googleapis";

export function rowsToCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsvField).join(",")).join("\r\n");
}

function escapeCsvField(field: string): string {
  if (/[",\r\n]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

export async function convertSpreadsheetToCsvFiles(
  sheetsClient: sheets_v4.Sheets,
  spreadsheetId: string
): Promise<Map<string, string>> {
  const meta = await sheetsClient.spreadsheets.get({ spreadsheetId });
  const sheetTitles = (meta.data.sheets ?? [])
    .map((s) => s.properties?.title)
    .filter((t): t is string => !!t);

  const result = new Map<string, string>();
  for (const title of sheetTitles) {
    const quotedTitle = `'${title.replace(/'/g, "''")}'`;
    const valuesRes = await sheetsClient.spreadsheets.values.get({
      spreadsheetId,
      range: quotedTitle,
    });
    const rows = (valuesRes.data.values ?? []) as string[][];
    result.set(title, rowsToCsv(rows));
  }
  return result;
}
```

- [ ] **Step 4: テストが通ることを確認**

```bash
pnpm test -- src/drive/convert/sheets.test.ts
```

Expected: PASS(3 tests)

- [ ] **Step 5: コミット**

```bash
git add src/drive/convert/sheets.ts src/drive/convert/sheets.test.ts
git commit -m "feat: convert Google Sheets to per-sheet CSV"
```

---

### Task 7: Googleドキュメント→Markdown変換

**Files:**
- Create: `src/drive/convert/docs.ts`
- Test: `src/drive/convert/docs.test.ts`

**Interfaces:**
- Consumes: なし(`docs_v1.Schema$Document`は`googleapis`から取得する型)
- Produces: `convertDocToMarkdown(document: docs_v1.Schema$Document): string`

- [ ] **Step 1: 失敗するテストを書く**

`src/drive/convert/docs.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("docs-markdown", () => ({
  googleDocsToMarkdown: vi.fn(
    () => "# Title\n\n![alt text](https://example.com/image.png)\n\nBody text\n"
  ),
}));

import { convertDocToMarkdown } from "./docs.js";

describe("convertDocToMarkdown", () => {
  it("converts the document and strips embedded images", () => {
    const markdown = convertDocToMarkdown({} as never);

    expect(markdown).toContain("# Title");
    expect(markdown).toContain("Body text");
    expect(markdown).not.toContain("![alt text]");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
pnpm test -- src/drive/convert/docs.test.ts
```

Expected: FAIL(モジュールが存在しない)

- [ ] **Step 3: `docs.ts`を実装**

`src/drive/convert/docs.ts`:

```ts
import type { docs_v1 } from "googleapis";
import { googleDocsToMarkdown } from "docs-markdown";

export function convertDocToMarkdown(document: docs_v1.Schema$Document): string {
  const markdown = googleDocsToMarkdown(document as unknown as Record<string, unknown>);
  return stripImages(markdown);
}

function stripImages(markdown: string): string {
  return markdown.replace(/!\[[^\]]*\]\([^)]*\)\n?/g, "");
}
```

- [ ] **Step 4: テストが通ることを確認**

```bash
pnpm test -- src/drive/convert/docs.test.ts
```

Expected: PASS(1 test)。もし`docs-markdown`のnamed exportが解決できないビルドエラーが出た場合は、実装を以下のdefault importパターンに変更する:

```ts
import docsMarkdown from "docs-markdown";
const { googleDocsToMarkdown } = docsMarkdown;
```

- [ ] **Step 5: コミット**

```bash
git add src/drive/convert/docs.ts src/drive/convert/docs.test.ts
git commit -m "feat: convert Google Docs to Markdown without embedded images"
```

---

### Task 8: 画像(webp/heic)→jpeg変換

**Files:**
- Create: `src/drive/convert/image.ts`
- Test: `src/drive/convert/image.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `convertToJpeg(input: Buffer): Promise<Buffer>`

- [ ] **Step 1: 失敗するテストを書く**

`src/drive/convert/image.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const toBuffer = vi.fn().mockResolvedValue(Buffer.from("jpeg-bytes"));
const jpeg = vi.fn().mockReturnValue({ toBuffer });
const sharpMock = vi.fn().mockReturnValue({ jpeg });

vi.mock("sharp", () => ({ default: sharpMock }));

import { convertToJpeg } from "./image.js";

describe("convertToJpeg", () => {
  it("pipes the input buffer through sharp's jpeg encoder", async () => {
    const input = Buffer.from("input-bytes");

    const result = await convertToJpeg(input);

    expect(sharpMock).toHaveBeenCalledWith(input);
    expect(jpeg).toHaveBeenCalled();
    expect(result.toString()).toBe("jpeg-bytes");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
pnpm test -- src/drive/convert/image.test.ts
```

Expected: FAIL(モジュールが存在しない)

- [ ] **Step 3: `image.ts`を実装**

`src/drive/convert/image.ts`:

```ts
import sharp from "sharp";

export async function convertToJpeg(input: Buffer): Promise<Buffer> {
  return sharp(input).jpeg().toBuffer();
}
```

- [ ] **Step 4: テストが通ることを確認**

```bash
pnpm test -- src/drive/convert/image.test.ts
```

Expected: PASS(1 test)

- [ ] **Step 5: コミット**

```bash
git add src/drive/convert/image.ts src/drive/convert/image.test.ts
git commit -m "feat: convert webp/heic images to jpeg via sharp"
```

---

### Task 9: GCS StorageProvider実装

**Files:**
- Create: `src/storage/gcsProvider.ts`
- Test: `src/storage/gcsProvider.test.ts`

**Interfaces:**
- Consumes: `StorageProvider`, `UploadParams`(`src/storage/StorageProvider.ts`)
- Produces: `class GcsStorageProvider implements StorageProvider`(コンストラクタ: `(storage: Storage, bucket: string, prefix?: string)`)

- [ ] **Step 1: 失敗するテストを書く**

`src/storage/gcsProvider.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { Storage } from "@google-cloud/storage";
import { GcsStorageProvider } from "./gcsProvider.js";

function createFakeStorage() {
  const file = {
    save: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue([true]),
    download: vi.fn().mockResolvedValue([Buffer.from("content")]),
  };
  const bucket = vi.fn().mockReturnValue({ file: vi.fn().mockReturnValue(file) });
  return { storage: { bucket } as unknown as Storage, bucket, file };
}

describe("GcsStorageProvider", () => {
  it("uploads with the prefix applied", async () => {
    const { storage, bucket, file } = createFakeStorage();
    const provider = new GcsStorageProvider(storage, "my-bucket", "backups");

    await provider.upload({ key: "a.txt", data: Buffer.from("x"), contentType: "text/plain" });

    expect(bucket).toHaveBeenCalledWith("my-bucket");
    expect(file.save).toHaveBeenCalledWith(Buffer.from("x"), { contentType: "text/plain" });
  });

  it("deletes with the prefix applied", async () => {
    const { storage, file } = createFakeStorage();
    const provider = new GcsStorageProvider(storage, "my-bucket", "backups");

    await provider.delete("a.txt");

    expect(file.delete).toHaveBeenCalledWith({ ignoreNotFound: true });
  });

  it("downloads existing content", async () => {
    const { storage } = createFakeStorage();
    const provider = new GcsStorageProvider(storage, "my-bucket");

    const result = await provider.download("a.txt");

    expect(result?.toString()).toBe("content");
  });

  it("returns undefined when the object does not exist", async () => {
    const { storage, file } = createFakeStorage();
    file.exists.mockResolvedValue([false]);
    const provider = new GcsStorageProvider(storage, "my-bucket");

    const result = await provider.download("missing.txt");

    expect(result).toBeUndefined();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
pnpm test -- src/storage/gcsProvider.test.ts
```

Expected: FAIL(モジュールが存在しない)

- [ ] **Step 3: `gcsProvider.ts`を実装**

`src/storage/gcsProvider.ts`:

```ts
import type { Storage } from "@google-cloud/storage";
import type { StorageProvider, UploadParams } from "./StorageProvider.js";

export class GcsStorageProvider implements StorageProvider {
  constructor(
    private readonly storage: Storage,
    private readonly bucket: string,
    private readonly prefix: string = ""
  ) {}

  private resolveKey(key: string): string {
    return this.prefix ? `${this.prefix.replace(/\/$/, "")}/${key}` : key;
  }

  async upload({ key, data, contentType }: UploadParams): Promise<void> {
    const file = this.storage.bucket(this.bucket).file(this.resolveKey(key));
    await file.save(data, { contentType });
  }

  async delete(key: string): Promise<void> {
    const file = this.storage.bucket(this.bucket).file(this.resolveKey(key));
    await file.delete({ ignoreNotFound: true });
  }

  async download(key: string): Promise<Buffer | undefined> {
    const file = this.storage.bucket(this.bucket).file(this.resolveKey(key));
    const [exists] = await file.exists();
    if (!exists) return undefined;
    const [data] = await file.download();
    return data;
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

```bash
pnpm test -- src/storage/gcsProvider.test.ts
```

Expected: PASS(4 tests)

- [ ] **Step 5: コミット**

```bash
git add src/storage/gcsProvider.ts src/storage/gcsProvider.test.ts
git commit -m "feat: add GCS StorageProvider implementation"
```

---

### Task 10: S3 StorageProvider実装

**Files:**
- Create: `src/storage/s3Provider.ts`
- Test: `src/storage/s3Provider.test.ts`

**Interfaces:**
- Consumes: `StorageProvider`, `UploadParams`(`src/storage/StorageProvider.ts`)
- Produces: `class S3StorageProvider implements StorageProvider`(コンストラクタ: `(client: S3Client, bucket: string, prefix?: string)`)

- [ ] **Step 1: 失敗するテストを書く**

`src/storage/s3Provider.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { S3Client } from "@aws-sdk/client-s3";
import { S3StorageProvider } from "./s3Provider.js";

describe("S3StorageProvider", () => {
  it("uploads with the prefix applied via PutObjectCommand", async () => {
    const send = vi.fn().mockResolvedValue({});
    const client = { send } as unknown as S3Client;
    const provider = new S3StorageProvider(client, "my-bucket", "backups");

    await provider.upload({ key: "a.txt", data: Buffer.from("x"), contentType: "text/plain" });

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0];
    expect(command.input).toEqual({
      Bucket: "my-bucket",
      Key: "backups/a.txt",
      Body: Buffer.from("x"),
      ContentType: "text/plain",
    });
  });

  it("deletes with the prefix applied via DeleteObjectCommand", async () => {
    const send = vi.fn().mockResolvedValue({});
    const client = { send } as unknown as S3Client;
    const provider = new S3StorageProvider(client, "my-bucket", "backups");

    await provider.delete("a.txt");

    const command = send.mock.calls[0][0];
    expect(command.input).toEqual({ Bucket: "my-bucket", Key: "backups/a.txt" });
  });

  it("downloads existing content via GetObjectCommand", async () => {
    const send = vi.fn().mockResolvedValue({
      Body: { transformToByteArray: () => Promise.resolve(new Uint8Array([1, 2, 3])) },
    });
    const client = { send } as unknown as S3Client;
    const provider = new S3StorageProvider(client, "my-bucket");

    const result = await provider.download("a.txt");

    expect(result).toEqual(Buffer.from([1, 2, 3]));
  });

  it("returns undefined when the object does not exist", async () => {
    const error = Object.assign(new Error("not found"), { name: "NoSuchKey" });
    const send = vi.fn().mockRejectedValue(error);
    const client = { send } as unknown as S3Client;
    const provider = new S3StorageProvider(client, "my-bucket");

    const result = await provider.download("missing.txt");

    expect(result).toBeUndefined();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
pnpm test -- src/storage/s3Provider.test.ts
```

Expected: FAIL(モジュールが存在しない)

- [ ] **Step 3: `s3Provider.ts`を実装**

`src/storage/s3Provider.ts`:

```ts
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import type { StorageProvider, UploadParams } from "./StorageProvider.js";

export class S3StorageProvider implements StorageProvider {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly prefix: string = ""
  ) {}

  private resolveKey(key: string): string {
    return this.prefix ? `${this.prefix.replace(/\/$/, "")}/${key}` : key;
  }

  async upload({ key, data, contentType }: UploadParams): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.resolveKey(key),
        Body: data,
        ContentType: contentType,
      })
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: this.resolveKey(key) })
    );
  }

  async download(key: string): Promise<Buffer | undefined> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.resolveKey(key) })
      );
      if (!res.Body) return undefined;
      const bytes = await res.Body.transformToByteArray();
      return Buffer.from(bytes);
    } catch (err) {
      if (isNoSuchKeyError(err)) return undefined;
      throw err;
    }
  }
}

function isNoSuchKeyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "name" in err && err.name === "NoSuchKey";
}
```

- [ ] **Step 4: テストが通ることを確認**

```bash
pnpm test -- src/storage/s3Provider.test.ts
```

Expected: PASS(4 tests)

- [ ] **Step 5: コミット**

```bash
git add src/storage/s3Provider.ts src/storage/s3Provider.test.ts
git commit -m "feat: add S3 StorageProvider implementation"
```

---

### Task 11: Driveフォルダの再帰的一覧取得

**Files:**
- Create: `src/drive/listFiles.ts`
- Test: `src/drive/listFiles.test.ts`

**Interfaces:**
- Consumes: `classifyMimeType`(`src/drive/convert/classify.ts`)、`ClassifiedFile`(`src/types.ts`)
- Produces: `listFilesRecursively(drive: drive_v3.Drive, rootFolderId: string): Promise<ClassifiedFile[]>`

- [ ] **Step 1: 失敗するテストを書く**

`src/drive/listFiles.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { drive_v3 } from "googleapis";
import { listFilesRecursively } from "./listFiles.js";

describe("listFilesRecursively", () => {
  it("recursively walks subfolders and builds relative paths", async () => {
    const list = vi.fn().mockImplementation(({ q }: { q: string }) => {
      if (q.includes("'root'")) {
        return Promise.resolve({
          data: {
            files: [
              {
                id: "folder-1",
                name: "sub",
                mimeType: "application/vnd.google-apps.folder",
                modifiedTime: "2026-08-01T00:00:00.000Z",
                parents: ["root"],
              },
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
      }
      if (q.includes("'folder-1'")) {
        return Promise.resolve({
          data: {
            files: [
              {
                id: "file-2",
                name: "notes.txt",
                mimeType: "text/plain",
                modifiedTime: "2026-08-02T00:00:00.000Z",
                parents: ["folder-1"],
              },
            ],
          },
        });
      }
      return Promise.resolve({ data: { files: [] } });
    });
    const drive = { files: { list } } as unknown as drive_v3.Drive;

    const result = await listFilesRecursively(drive, "root");

    expect(result).toHaveLength(2);
    expect(result.find((f) => f.id === "file-1")?.path).toBe("readme.txt");
    expect(result.find((f) => f.id === "file-2")?.path).toBe("sub/notes.txt");
    expect(result.find((f) => f.id === "file-2")?.conversionKind).toBe("copy");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
pnpm test -- src/drive/listFiles.test.ts
```

Expected: FAIL(モジュールが存在しない)

- [ ] **Step 3: `listFiles.ts`を実装**

`src/drive/listFiles.ts`:

```ts
import type { drive_v3 } from "googleapis";
import type { ClassifiedFile } from "../types.js";
import { classifyMimeType } from "./convert/classify.js";

const FOLDER_MIME = "application/vnd.google-apps.folder";

export async function listFilesRecursively(
  drive: drive_v3.Drive,
  rootFolderId: string
): Promise<ClassifiedFile[]> {
  const result: ClassifiedFile[] = [];
  await walk(drive, rootFolderId, "", result);
  return result;
}

async function walk(
  drive: drive_v3.Drive,
  folderId: string,
  pathPrefix: string,
  result: ClassifiedFile[]
): Promise<void> {
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, modifiedTime, parents)",
      pageToken,
    });
    const files = res.data.files ?? [];
    for (const file of files) {
      if (!file.id || !file.name || !file.mimeType || !file.modifiedTime) continue;
      const path = pathPrefix ? `${pathPrefix}/${file.name}` : file.name;
      if (file.mimeType === FOLDER_MIME) {
        await walk(drive, file.id, path, result);
      } else {
        result.push({
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          modifiedTime: file.modifiedTime,
          path,
          parents: file.parents ?? [],
          conversionKind: classifyMimeType(file.mimeType),
        });
      }
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
}
```

- [ ] **Step 4: テストが通ることを確認**

```bash
pnpm test -- src/drive/listFiles.test.ts
```

Expected: PASS(1 test)

- [ ] **Step 5: コミット**

```bash
git add src/drive/listFiles.ts src/drive/listFiles.test.ts
git commit -m "feat: recursively list and classify Drive folder contents"
```

---

### Task 12: ファイル変換ディスパッチャ

**Files:**
- Create: `src/drive/convert/dispatch.ts`
- Test: `src/drive/convert/dispatch.test.ts`

**Interfaces:**
- Consumes: `convertDocToMarkdown`(Task 7)、`convertSpreadsheetToCsvFiles`(Task 6)、`convertToJpeg`(Task 8)、`ClassifiedFile`(`src/types.ts`)
- Produces:
  - `interface ConversionOutput { outputPath: string; data: Buffer; contentType: string; }`
  - `interface ConvertDeps { drive: drive_v3.Drive; docs: docs_v1.Docs; sheets: sheets_v4.Sheets; }`
  - `convertFile(file: ClassifiedFile, deps: ConvertDeps): Promise<ConversionOutput[]>`

- [ ] **Step 1: 失敗するテストを書く**

`src/drive/convert/dispatch.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { docs_v1, drive_v3, sheets_v4 } from "googleapis";
import type { ClassifiedFile } from "../../types.js";

vi.mock("./docs.js", () => ({
  convertDocToMarkdown: vi.fn().mockReturnValue("# Markdown"),
}));
vi.mock("./sheets.js", () => ({
  convertSpreadsheetToCsvFiles: vi.fn().mockResolvedValue(
    new Map([
      ["Sheet1", "a,b"],
      ["Sheet 2", "c,d"],
    ])
  ),
}));
vi.mock("./image.js", () => ({
  convertToJpeg: vi.fn().mockResolvedValue(Buffer.from("jpeg-bytes")),
}));

import { convertFile } from "./dispatch.js";

function baseFile(overrides: Partial<ClassifiedFile>): ClassifiedFile {
  return {
    id: "file-id",
    name: "name",
    mimeType: "text/plain",
    modifiedTime: "2026-08-01T00:00:00.000Z",
    path: "path/name",
    parents: [],
    conversionKind: "copy",
    ...overrides,
  };
}

describe("convertFile", () => {
  it("converts a Google Doc to a single markdown output", async () => {
    const docs = { documents: { get: vi.fn().mockResolvedValue({ data: {} }) } } as unknown as docs_v1.Docs;
    const deps = { drive: {} as drive_v3.Drive, docs, sheets: {} as sheets_v4.Sheets };
    const file = baseFile({ conversionKind: "google-doc-to-markdown", path: "docs/report" });

    const outputs = await convertFile(file, deps);

    expect(outputs).toEqual([
      { outputPath: "docs/report.md", data: Buffer.from("# Markdown"), contentType: "text/markdown" },
    ]);
  });

  it("converts a Google Sheet to one CSV output per sheet", async () => {
    const sheets = {} as sheets_v4.Sheets;
    const deps = { drive: {} as drive_v3.Drive, docs: {} as docs_v1.Docs, sheets };
    const file = baseFile({ conversionKind: "google-sheet-to-csv", path: "sheets/sales" });

    const outputs = await convertFile(file, deps);

    expect(outputs).toEqual([
      { outputPath: "sheets/sales/Sheet1.csv", data: Buffer.from("a,b"), contentType: "text/csv" },
      { outputPath: "sheets/sales/Sheet 2.csv", data: Buffer.from("c,d"), contentType: "text/csv" },
    ]);
  });

  it("downloads and converts webp/heic images to jpeg", async () => {
    const drive = {
      files: {
        get: vi.fn().mockResolvedValue({ data: new Uint8Array([9, 9, 9]).buffer }),
      },
    } as unknown as drive_v3.Drive;
    const deps = { drive, docs: {} as docs_v1.Docs, sheets: {} as sheets_v4.Sheets };
    const file = baseFile({
      conversionKind: "image-convert-to-jpeg",
      path: "images/photo.webp",
      mimeType: "image/webp",
    });

    const outputs = await convertFile(file, deps);

    expect(outputs).toEqual([
      { outputPath: "images/photo.jpg", data: Buffer.from("jpeg-bytes"), contentType: "image/jpeg" },
    ]);
  });

  it("downloads and copies other files as-is", async () => {
    const drive = {
      files: { get: vi.fn().mockResolvedValue({ data: new Uint8Array([1, 2, 3]).buffer }) },
    } as unknown as drive_v3.Drive;
    const deps = { drive, docs: {} as docs_v1.Docs, sheets: {} as sheets_v4.Sheets };
    const file = baseFile({ conversionKind: "copy", path: "files/doc.pdf", mimeType: "application/pdf" });

    const outputs = await convertFile(file, deps);

    expect(outputs).toEqual([
      { outputPath: "files/doc.pdf", data: Buffer.from([1, 2, 3]), contentType: "application/pdf" },
    ]);
  });

  it("returns no outputs for excluded files", async () => {
    const deps = { drive: {} as drive_v3.Drive, docs: {} as docs_v1.Docs, sheets: {} as sheets_v4.Sheets };
    const file = baseFile({ conversionKind: "excluded" });

    const outputs = await convertFile(file, deps);

    expect(outputs).toEqual([]);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
pnpm test -- src/drive/convert/dispatch.test.ts
```

Expected: FAIL(モジュールが存在しない)

- [ ] **Step 3: `dispatch.ts`を実装**

`src/drive/convert/dispatch.ts`:

```ts
import type { docs_v1, drive_v3, sheets_v4 } from "googleapis";
import type { ClassifiedFile } from "../../types.js";
import { convertDocToMarkdown } from "./docs.js";
import { convertToJpeg } from "./image.js";
import { convertSpreadsheetToCsvFiles } from "./sheets.js";

export interface ConversionOutput {
  outputPath: string;
  data: Buffer;
  contentType: string;
}

export interface ConvertDeps {
  drive: drive_v3.Drive;
  docs: docs_v1.Docs;
  sheets: sheets_v4.Sheets;
}

export async function convertFile(
  file: ClassifiedFile,
  deps: ConvertDeps
): Promise<ConversionOutput[]> {
  switch (file.conversionKind) {
    case "google-doc-to-markdown": {
      const res = await deps.docs.documents.get({ documentId: file.id });
      const markdown = convertDocToMarkdown(res.data);
      return [
        {
          outputPath: `${file.path}.md`,
          data: Buffer.from(markdown, "utf-8"),
          contentType: "text/markdown",
        },
      ];
    }
    case "google-sheet-to-csv": {
      const csvBySheet = await convertSpreadsheetToCsvFiles(deps.sheets, file.id);
      return Array.from(csvBySheet.entries()).map(([sheetTitle, csv]) => ({
        outputPath: `${file.path}/${sanitizeForPath(sheetTitle)}.csv`,
        data: Buffer.from(csv, "utf-8"),
        contentType: "text/csv",
      }));
    }
    case "image-convert-to-jpeg": {
      const raw = await downloadDriveFile(deps.drive, file.id);
      const jpeg = await convertToJpeg(raw);
      const newPath = file.path.replace(/\.[^./]+$/, ".jpg");
      return [{ outputPath: newPath, data: jpeg, contentType: "image/jpeg" }];
    }
    case "copy": {
      const raw = await downloadDriveFile(deps.drive, file.id);
      return [{ outputPath: file.path, data: raw, contentType: file.mimeType }];
    }
    case "excluded":
      return [];
  }
}

function sanitizeForPath(name: string): string {
  return name.replace(/[/\\]/g, "_");
}

async function downloadDriveFile(drive: drive_v3.Drive, fileId: string): Promise<Buffer> {
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(res.data as ArrayBuffer);
}
```

- [ ] **Step 4: テストが通ることを確認**

```bash
pnpm test -- src/drive/convert/dispatch.test.ts
```

Expected: PASS(5 tests)

- [ ] **Step 5: コミット**

```bash
git add src/drive/convert/dispatch.ts src/drive/convert/dispatch.test.ts
git commit -m "feat: dispatch Drive files to the correct converter"
```

---

### Task 13: Google APIクライアント生成

**Files:**
- Create: `src/drive/client.ts`
- Test: `src/drive/client.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `interface GoogleClients { drive: drive_v3.Drive; docs: docs_v1.Docs; sheets: sheets_v4.Sheets; }`
  - `createGoogleClients(): Promise<GoogleClients>`

- [ ] **Step 1: 失敗するテストを書く**

`src/drive/client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const getClient = vi.fn().mockResolvedValue({ fake: "auth-client" });
const driveFactory = vi.fn().mockReturnValue({ fake: "drive" });
const docsFactory = vi.fn().mockReturnValue({ fake: "docs" });
const sheetsFactory = vi.fn().mockReturnValue({ fake: "sheets" });

vi.mock("google-auth-library", () => ({
  GoogleAuth: vi.fn().mockImplementation(() => ({ getClient })),
}));
vi.mock("googleapis", () => ({
  google: {
    drive: driveFactory,
    docs: docsFactory,
    sheets: sheetsFactory,
  },
}));

import { GoogleAuth } from "google-auth-library";
import { createGoogleClients } from "./client.js";

describe("createGoogleClients", () => {
  it("authenticates with the expected scopes and returns all three clients", async () => {
    const clients = await createGoogleClients();

    expect(GoogleAuth).toHaveBeenCalledWith({
      scopes: [
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/documents.readonly",
        "https://www.googleapis.com/auth/spreadsheets.readonly",
      ],
    });
    expect(getClient).toHaveBeenCalled();
    expect(clients.drive).toEqual({ fake: "drive" });
    expect(clients.docs).toEqual({ fake: "docs" });
    expect(clients.sheets).toEqual({ fake: "sheets" });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
pnpm test -- src/drive/client.test.ts
```

Expected: FAIL(モジュールが存在しない)

- [ ] **Step 3: `client.ts`を実装**

`src/drive/client.ts`:

```ts
import { GoogleAuth } from "google-auth-library";
import { type docs_v1, type drive_v3, google, type sheets_v4 } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/documents.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
];

export interface GoogleClients {
  drive: drive_v3.Drive;
  docs: docs_v1.Docs;
  sheets: sheets_v4.Sheets;
}

export async function createGoogleClients(): Promise<GoogleClients> {
  const auth = new GoogleAuth({ scopes: SCOPES });
  const authClient = await auth.getClient();
  return {
    drive: google.drive({ version: "v3", auth: authClient as never }),
    docs: google.docs({ version: "v1", auth: authClient as never }),
    sheets: google.sheets({ version: "v4", auth: authClient as never }),
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

```bash
pnpm test -- src/drive/client.test.ts
```

Expected: PASS(1 test)

- [ ] **Step 5: コミット**

```bash
git add src/drive/client.ts src/drive/client.test.ts
git commit -m "feat: create ADC-authenticated Google API clients"
```

---

### Task 14: 同期オーケストレーション(syncMapping)

**Files:**
- Create: `src/sync/syncRunner.ts`
- Test: `src/sync/syncRunner.test.ts`

**Interfaces:**
- Consumes: `listFilesRecursively`(Task 11)、`convertFile`(Task 12)、`readMetadata`/`writeMetadata`(Task 4)、`diffFiles`(Task 5)、`StorageProvider`(Task 4)
- Produces:
  - `interface SyncMappingDeps { drive: drive_v3.Drive; docs: docs_v1.Docs; sheets: sheets_v4.Sheets; storage: StorageProvider; dryRun: boolean; }`
  - `interface SyncMappingResult { uploaded: string[]; deleted: string[]; failed: { sourcePath: string; error: string }[]; }`
  - `syncMapping(driveFolderId: string, deps: SyncMappingDeps): Promise<SyncMappingResult>`

- [ ] **Step 1: 失敗するテストを書く**

`src/sync/syncRunner.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { StorageProvider, UploadParams } from "../storage/StorageProvider.js";
import type { ClassifiedFile, SyncMetadata } from "../types.js";

const listFilesRecursively = vi.fn();
const convertFile = vi.fn();

vi.mock("../drive/listFiles.js", () => ({ listFilesRecursively }));
vi.mock("../drive/convert/dispatch.js", () => ({ convertFile }));

import { syncMapping } from "./syncRunner.js";

class FakeStorageProvider implements StorageProvider {
  store = new Map<string, Buffer>();
  uploadCalls: UploadParams[] = [];
  deleteCalls: string[] = [];

  async upload(params: UploadParams): Promise<void> {
    this.uploadCalls.push(params);
    this.store.set(params.key, params.data);
  }

  async delete(key: string): Promise<void> {
    this.deleteCalls.push(key);
    this.store.delete(key);
  }

  async download(key: string): Promise<Buffer | undefined> {
    return this.store.get(key);
  }
}

function fakeDeps(storage: StorageProvider, dryRun = false) {
  return {
    drive: {} as never,
    docs: {} as never,
    sheets: {} as never,
    storage,
    dryRun,
  };
}

describe("syncMapping", () => {
  it("uploads new files and writes metadata", async () => {
    const storage = new FakeStorageProvider();
    const file: ClassifiedFile = {
      id: "id-1",
      name: "report",
      mimeType: "application/vnd.google-apps.document",
      modifiedTime: "2026-08-01T00:00:00.000Z",
      path: "report",
      parents: [],
      conversionKind: "google-doc-to-markdown",
    };
    listFilesRecursively.mockResolvedValue([file]);
    convertFile.mockResolvedValue([
      { outputPath: "report.md", data: Buffer.from("# R"), contentType: "text/markdown" },
    ]);

    const result = await syncMapping("folder-id", fakeDeps(storage));

    expect(result.uploaded).toEqual(["report.md"]);
    expect(result.deleted).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(storage.store.get("report.md")?.toString()).toBe("# R");

    const metadata = JSON.parse(storage.store.get("metadata.json")?.toString() ?? "{}") as SyncMetadata;
    expect(metadata.files).toEqual([
      {
        path: "report.md",
        sourcePath: "report",
        originUrl: "https://drive.google.com/open?id=id-1",
        linkUrl: "https://drive.google.com/open?id=id-1",
        modifiedTime: "2026-08-01T00:00:00.000Z",
      },
    ]);
  });

  it("deletes files that are no longer present in Drive", async () => {
    const storage = new FakeStorageProvider();
    const existingMetadata: SyncMetadata = {
      files: [
        {
          path: "removed.txt",
          sourcePath: "removed.txt",
          originUrl: "https://drive.google.com/open?id=old",
          linkUrl: "https://drive.google.com/open?id=old",
          modifiedTime: "2026-08-01T00:00:00.000Z",
        },
      ],
      updatedAt: "2026-08-01T00:00:00.000Z",
    };
    await storage.upload({
      key: "metadata.json",
      data: Buffer.from(JSON.stringify(existingMetadata)),
      contentType: "application/json",
    });
    listFilesRecursively.mockResolvedValue([]);

    const result = await syncMapping("folder-id", fakeDeps(storage));

    expect(result.deleted).toEqual(["removed.txt"]);
    expect(storage.deleteCalls).toEqual(["removed.txt"]);
  });

  it("records failures without aborting the whole sync", async () => {
    const storage = new FakeStorageProvider();
    const file: ClassifiedFile = {
      id: "id-2",
      name: "broken.txt",
      mimeType: "text/plain",
      modifiedTime: "2026-08-01T00:00:00.000Z",
      path: "broken.txt",
      parents: [],
      conversionKind: "copy",
    };
    listFilesRecursively.mockResolvedValue([file]);
    convertFile.mockRejectedValue(new Error("download failed"));

    const result = await syncMapping("folder-id", fakeDeps(storage));

    expect(result.failed).toEqual([{ sourcePath: "broken.txt", error: "download failed" }]);
    expect(result.uploaded).toEqual([]);
  });

  it("does not upload, delete, or write metadata in dry-run mode", async () => {
    const storage = new FakeStorageProvider();
    const file: ClassifiedFile = {
      id: "id-3",
      name: "new.txt",
      mimeType: "text/plain",
      modifiedTime: "2026-08-01T00:00:00.000Z",
      path: "new.txt",
      parents: [],
      conversionKind: "copy",
    };
    listFilesRecursively.mockResolvedValue([file]);
    convertFile.mockResolvedValue([
      { outputPath: "new.txt", data: Buffer.from("x"), contentType: "text/plain" },
    ]);

    const result = await syncMapping("folder-id", fakeDeps(storage, true));

    expect(result.uploaded).toEqual(["new.txt"]);
    expect(storage.store.has("new.txt")).toBe(false);
    expect(storage.store.has("metadata.json")).toBe(false);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
pnpm test -- src/sync/syncRunner.test.ts
```

Expected: FAIL(モジュールが存在しない)

- [ ] **Step 3: `syncRunner.ts`を実装**

`src/sync/syncRunner.ts`:

```ts
import type { docs_v1, drive_v3, sheets_v4 } from "googleapis";
import { convertFile } from "../drive/convert/dispatch.js";
import { listFilesRecursively } from "../drive/listFiles.js";
import type { StorageProvider } from "../storage/StorageProvider.js";
import type { MetadataFileEntry, SyncMetadata } from "../types.js";
import { diffFiles } from "./diff.js";
import { readMetadata, writeMetadata } from "./metadata.js";

export interface SyncMappingDeps {
  drive: drive_v3.Drive;
  docs: docs_v1.Docs;
  sheets: sheets_v4.Sheets;
  storage: StorageProvider;
  dryRun: boolean;
}

export interface SyncMappingResult {
  uploaded: string[];
  deleted: string[];
  failed: { sourcePath: string; error: string }[];
}

export async function syncMapping(
  driveFolderId: string,
  deps: SyncMappingDeps
): Promise<SyncMappingResult> {
  const result: SyncMappingResult = { uploaded: [], deleted: [], failed: [] };

  const driveFiles = await listFilesRecursively(deps.drive, driveFolderId);
  const metadata = await readMetadata(deps.storage);
  const { toUpload, toDelete } = diffFiles(driveFiles, metadata);

  const deletedPaths = new Set(toDelete.map((d) => d.path));
  const reuploadSourcePaths = new Set(toUpload.map((f) => f.path));
  const entries: MetadataFileEntry[] = metadata.files.filter(
    (entry) => !deletedPaths.has(entry.path) && !reuploadSourcePaths.has(entry.sourcePath)
  );

  for (const file of toUpload) {
    try {
      const outputs = await convertFile(file, deps);
      for (const output of outputs) {
        if (!deps.dryRun) {
          await deps.storage.upload({
            key: output.outputPath,
            data: output.data,
            contentType: output.contentType,
          });
        }
        result.uploaded.push(output.outputPath);
        const url = `https://drive.google.com/open?id=${file.id}`;
        entries.push({
          path: output.outputPath,
          sourcePath: file.path,
          originUrl: url,
          linkUrl: url,
          modifiedTime: file.modifiedTime,
        });
      }
    } catch (err) {
      result.failed.push({
        sourcePath: file.path,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  for (const entry of toDelete) {
    if (!deps.dryRun) {
      await deps.storage.delete(entry.path);
    }
    result.deleted.push(entry.path);
  }

  if (!deps.dryRun) {
    const newMetadata: SyncMetadata = { files: entries, updatedAt: new Date().toISOString() };
    await writeMetadata(deps.storage, newMetadata);
  }

  return result;
}
```

- [ ] **Step 4: テストが通ることを確認**

```bash
pnpm test -- src/sync/syncRunner.test.ts
```

Expected: PASS(4 tests)

- [ ] **Step 5: コミット**

```bash
git add src/sync/syncRunner.ts src/sync/syncRunner.test.ts
git commit -m "feat: orchestrate Drive-to-storage sync with diffing and metadata"
```

---

### Task 15: CLIエントリポイント

**Files:**
- Create: `src/cli/createStorageProvider.ts`
- Test: `src/cli/createStorageProvider.test.ts`
- Create: `src/cli.ts`
- Delete: `src/index.ts`(Task 1のプレースホルダーを置き換える)

**Interfaces:**
- Consumes: `Destination`(`src/config/schema.ts`)、`GcsStorageProvider`(Task 9)、`S3StorageProvider`(Task 10)、`loadConfig`(Task 2)、`createGoogleClients`(Task 13)、`syncMapping`(Task 14)
- Produces: `createStorageProvider(destination: Destination): StorageProvider`、実行可能な`dist/cli.js`

- [ ] **Step 1: 失敗するテストを書く**

`src/cli/createStorageProvider.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { GcsStorageProvider } from "../storage/gcsProvider.js";
import { S3StorageProvider } from "../storage/s3Provider.js";
import { createStorageProvider } from "./createStorageProvider.js";

describe("createStorageProvider", () => {
  it("creates a GcsStorageProvider for provider: gcs", () => {
    const provider = createStorageProvider({ provider: "gcs", bucket: "b", prefix: "p" });

    expect(provider).toBeInstanceOf(GcsStorageProvider);
  });

  it("creates an S3StorageProvider for provider: s3", () => {
    const provider = createStorageProvider({
      provider: "s3",
      bucket: "b",
      region: "ap-northeast-1",
    });

    expect(provider).toBeInstanceOf(S3StorageProvider);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
pnpm test -- src/cli/createStorageProvider.test.ts
```

Expected: FAIL(モジュールが存在しない)

- [ ] **Step 3: `createStorageProvider.ts`を実装**

`src/cli/createStorageProvider.ts`:

```ts
import { Storage } from "@google-cloud/storage";
import { S3Client } from "@aws-sdk/client-s3";
import type { Destination } from "../config/schema.js";
import { GcsStorageProvider } from "../storage/gcsProvider.js";
import { S3StorageProvider } from "../storage/s3Provider.js";
import type { StorageProvider } from "../storage/StorageProvider.js";

export function createStorageProvider(destination: Destination): StorageProvider {
  if (destination.provider === "gcs") {
    return new GcsStorageProvider(new Storage(), destination.bucket, destination.prefix);
  }
  return new S3StorageProvider(
    new S3Client({ region: destination.region }),
    destination.bucket,
    destination.prefix
  );
}
```

- [ ] **Step 4: テストが通ることを確認**

```bash
pnpm test -- src/cli/createStorageProvider.test.ts
```

Expected: PASS(2 tests)

- [ ] **Step 5: `cli.ts`を実装**

`src/cli.ts`:

```ts
#!/usr/bin/env node
import { Command } from "commander";
import { createStorageProvider } from "./cli/createStorageProvider.js";
import { loadConfig } from "./config/loadConfig.js";
import { createGoogleClients } from "./drive/client.js";
import { syncMapping } from "./sync/syncRunner.js";

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("gdrive-to-cloud-storage")
    .requiredOption("-c, --config <path>", "path to config YAML file")
    .option("--dry-run", "list changes without uploading or deleting", false);
  program.parse(process.argv);
  const options = program.opts<{ config: string; dryRun: boolean }>();

  const config = await loadConfig(options.config);
  const { drive, docs, sheets } = await createGoogleClients();

  let hasFailure = false;
  for (const mapping of config.mappings) {
    const storage = createStorageProvider(mapping.destination);
    const result = await syncMapping(mapping.driveFolderId, {
      drive,
      docs,
      sheets,
      storage,
      dryRun: options.dryRun,
    });

    console.log(
      `[${mapping.driveFolderId}] uploaded=${result.uploaded.length} deleted=${result.deleted.length} failed=${result.failed.length}`
    );
    for (const failure of result.failed) {
      console.error(`  FAILED ${failure.sourcePath}: ${failure.error}`);
      hasFailure = true;
    }
  }

  if (hasFailure) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exitCode = 1;
});
```

- [ ] **Step 6: プレースホルダーの`src/index.ts`を削除**

```bash
git rm src/index.ts
```

- [ ] **Step 7: ビルドが通ることを確認**

```bash
pnpm build
```

Expected: エラーなく`dist/cli.js`が生成される

- [ ] **Step 8: コミット**

```bash
git add src/cli.ts src/cli/createStorageProvider.ts src/cli/createStorageProvider.test.ts
git commit -m "feat: wire up CLI entry point with commander"
```

---

### Task 16: 最終検証とREADMEへの使い方追記

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: なし
- Produces: なし(検証と使用方法ドキュメントの追加)

- [ ] **Step 1: 全テストを実行**

```bash
pnpm test
```

Expected: 全テストがPASS

- [ ] **Step 2: Lintを実行**

```bash
pnpm lint
```

Expected: エラーなく終了(警告が出た場合は修正してから次へ)

- [ ] **Step 3: ビルドを実行**

```bash
pnpm build
```

Expected: エラーなく`dist/`が生成される

- [ ] **Step 4: READMEに使い方セクションを追記**

`README.md`の末尾に以下を追記する:

```markdown

# 使い方

## インストール

\`\`\`bash
pnpm install
pnpm build
\`\`\`

## 設定ファイル

`config.yaml`を作成する:

\`\`\`yaml
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
\`\`\`

## 認証

- Google Drive: ADC(Application Default Credentials)で取得したサービスアカウントを使用する。事前に`gcloud auth application-default login`、または`GOOGLE_APPLICATION_CREDENTIALS`環境変数でサービスアカウントキーを指定する
- GCS: Google Cloudのデフォルト認証(ADC)を使用する
- S3: AWSのデフォルト認証チェーン(環境変数、`~/.aws/credentials`、IAMロール等)を使用する

## 実行

\`\`\`bash
node dist/cli.js --config config.yaml
node dist/cli.js --config config.yaml --dry-run
\`\`\`
```

- [ ] **Step 5: コミット**

```bash
git add README.md
git commit -m "docs: add usage instructions to README"
```

---

## 実装後の既知の制約

- Google Sheetsのシート名が変更・削除された場合、旧シート名に対応するCSVオブジェクトはCloud Storage上に孤立して残る可能性がある(metadataからは削除されるが、実体の削除は行わない)。将来的な改善余地として記録する
- E2E(実際のGoogle Drive/GCS/S3への接続)テストは対象外。手動での動作確認が必要
