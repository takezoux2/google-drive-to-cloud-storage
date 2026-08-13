# Local Storage Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `"local"` destination provider so a Drive folder mapping in `config.yaml` can sync to a local filesystem directory, alongside the existing `gcs`/`s3` providers.

**Architecture:** Implement `LocalStorageProvider` against the existing `StorageProvider` interface (`upload`/`delete`/`download`) using `node:fs/promises`, so `syncRunner.ts` and `metadata.ts` require no changes. Extend the Zod config schema to accept `provider: "local"` with a new `path` field, and wire the new provider into `createStorageProvider.ts`.

**Tech Stack:** TypeScript (strict, ESM), Zod v4, vitest, Node built-ins (`node:fs/promises`, `node:path`, `node:os`).

## Global Constraints

- `tsconfig.json` has `"strict": true` — no implicit `any`, no unchecked `undefined` access.
- Do not change the `StorageProvider` interface (`src/storage/StorageProvider.ts`) — all providers must keep satisfying it as-is.
- Follow existing test patterns exactly: vitest, real temp-directory I/O for filesystem-touching tests (see `src/config/loadConfig.test.ts`'s `mkdtemp`/`afterEach(rm)` pattern), SDK mocking only where an SDK is involved (not applicable here — local provider has no SDK).
- Spec reference: `docs/superpowers/specs/2026-08-13-local-storage-provider-design.md`.

---

### Task 1: Config schema accepts `provider: "local"` with a `path` field

**Files:**
- Modify: `src/config/schema.ts`
- Test: `src/config/loadConfig.test.ts`

**Interfaces:**
- Produces: `destinationSchema` (Zod schema) accepting `provider: "gcs" | "s3" | "local"`, with `bucket` and `path` both optional in the object shape but validated per-provider via `superRefine`. `Destination` type (`z.infer<typeof destinationSchema>`) gains an optional `path?: string` field; `bucket` becomes `bucket?: string`.

- [ ] **Step 1: Write the failing tests**

Add these three cases to `src/config/loadConfig.test.ts`, inside the existing `describe("loadConfig", ...)` block (reuse the existing `dir`/`beforeEach`/`afterEach` setup already in the file):

```ts
  it("parses a valid local provider config", async () => {
    const configPath = path.join(dir, "local.yaml");
    await writeFile(
      configPath,
      `
mappings:
  - driveFolderId: "abc123"
    destination:
      provider: local
      path: "./backups/team-c"
      prefix: "docs"
`,
      "utf-8",
    );

    const config = await loadConfig(configPath);

    expect(config.mappings[0].destination.provider).toBe("local");
    expect(config.mappings[0].destination.path).toBe("./backups/team-c");
  });

  it("throws when provider is local and path is missing", async () => {
    const configPath = path.join(dir, "local-missing-path.yaml");
    await writeFile(
      configPath,
      `
mappings:
  - driveFolderId: "abc123"
    destination:
      provider: local
`,
      "utf-8",
    );

    await expect(loadConfig(configPath)).rejects.toThrow();
  });

  it("throws when provider is gcs and bucket is missing", async () => {
    const configPath = path.join(dir, "gcs-missing-bucket.yaml");
    await writeFile(
      configPath,
      `
mappings:
  - driveFolderId: "abc123"
    destination:
      provider: gcs
`,
      "utf-8",
    );

    await expect(loadConfig(configPath)).rejects.toThrow();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/config/loadConfig.test.ts`
Expected: The `"parses a valid local provider config"` case fails (Zod rejects `provider: "local"` since the enum doesn't include it yet). The two `"throws when..."` cases pass by coincidence (current schema already throws when `bucket` is missing for any provider) — that's fine, they'll stay green through Step 3.

- [ ] **Step 3: Update the schema**

In `src/config/schema.ts`, replace the current `destinationSchema` definition:

```ts
export const destinationSchema = z.object({
  provider: z.enum(["gcs", "s3"]),
  bucket: z.string().min(1),
  prefix: z.string().optional(),
  region: z.string().optional(),
});
```

with:

```ts
export const destinationSchema = z
  .object({
    provider: z.enum(["gcs", "s3", "local"]),
    bucket: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    prefix: z.string().optional(),
    region: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.provider === "local") {
      if (!data.path) {
        ctx.addIssue({
          code: "custom",
          message: 'path is required when provider is "local"',
          path: ["path"],
        });
      }
    } else if (!data.bucket) {
      ctx.addIssue({
        code: "custom",
        message: 'bucket is required when provider is "gcs" or "s3"',
        path: ["bucket"],
      });
    }
  });
```

The rest of `src/config/schema.ts` (`mappingSchema`, `configSchema`, and the exported types) stays unchanged — `Destination`/`Mapping`/`AppConfig` are still derived via `z.infer`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run src/config/loadConfig.test.ts`
Expected: All cases pass, including the pre-existing ones in the file.

- [ ] **Step 5: Typecheck**

Run: `pnpm build`
Expected: Compiles cleanly. (This will surface any place that assumed `bucket` was required — that's addressed in Task 3.)

- [ ] **Step 6: Commit**

```bash
git add src/config/schema.ts src/config/loadConfig.test.ts
git commit -m "feat: accept local provider with path field in config schema"
```

---

### Task 2: `LocalStorageProvider`

**Files:**
- Create: `src/storage/localProvider.ts`
- Test: `src/storage/localProvider.test.ts`

**Interfaces:**
- Consumes: `StorageProvider`, `UploadParams` from `src/storage/StorageProvider.ts` (unchanged: `upload({key, data, contentType}): Promise<void>`, `delete(key): Promise<void>`, `download(key): Promise<Buffer | undefined>`).
- Produces: `export class LocalStorageProvider implements StorageProvider`, constructor `(basePath: string, prefix: string = "")` — same constructor shape as `GcsStorageProvider`/`S3StorageProvider` (client-or-root arg replaced by `basePath`, then `prefix`).

- [ ] **Step 1: Write the failing test**

Create `src/storage/localProvider.test.ts`:

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalStorageProvider } from "./localProvider.js";

describe("LocalStorageProvider", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "gdrive-sync-local-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("uploads a file, creating nested directories as needed", async () => {
    const provider = new LocalStorageProvider(dir);

    await provider.upload({
      key: "a/b/c.txt",
      data: Buffer.from("hello"),
      contentType: "text/plain",
    });

    const content = await readFile(path.join(dir, "a", "b", "c.txt"));
    expect(content.toString()).toBe("hello");
  });

  it("uploads under the prefix when one is set", async () => {
    const provider = new LocalStorageProvider(dir, "backups");

    await provider.upload({
      key: "a.txt",
      data: Buffer.from("x"),
      contentType: "text/plain",
    });

    const content = await readFile(path.join(dir, "backups", "a.txt"));
    expect(content.toString()).toBe("x");
  });

  it("deletes an existing file", async () => {
    const provider = new LocalStorageProvider(dir);
    await provider.upload({
      key: "a.txt",
      data: Buffer.from("x"),
      contentType: "text/plain",
    });

    await provider.delete("a.txt");

    await expect(readFile(path.join(dir, "a.txt"))).rejects.toThrow();
  });

  it("does not throw when deleting a file that does not exist", async () => {
    const provider = new LocalStorageProvider(dir);

    await expect(provider.delete("missing.txt")).resolves.toBeUndefined();
  });

  it("downloads existing content", async () => {
    const provider = new LocalStorageProvider(dir);
    await provider.upload({
      key: "a.txt",
      data: Buffer.from("content"),
      contentType: "text/plain",
    });

    const result = await provider.download("a.txt");

    expect(result?.toString()).toBe("content");
  });

  it("returns undefined when the file does not exist", async () => {
    const provider = new LocalStorageProvider(dir);

    const result = await provider.download("missing.txt");

    expect(result).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/storage/localProvider.test.ts`
Expected: FAIL — `./localProvider.js` cannot be found.

- [ ] **Step 3: Write the implementation**

Create `src/storage/localProvider.ts`:

```ts
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StorageProvider, UploadParams } from "./StorageProvider.js";

export class LocalStorageProvider implements StorageProvider {
  constructor(
    private readonly basePath: string,
    private readonly prefix: string = "",
  ) {}

  private resolveKey(key: string): string {
    return path.join(this.basePath, this.prefix, key);
  }

  async upload({ key, data }: UploadParams): Promise<void> {
    const resolved = this.resolveKey(key);
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFile(resolved, data);
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolveKey(key));
    } catch (err) {
      if (!isEnoent(err)) throw err;
    }
  }

  async download(key: string): Promise<Buffer | undefined> {
    try {
      return await readFile(this.resolveKey(key));
    } catch (err) {
      if (isEnoent(err)) return undefined;
      throw err;
    }
  }
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    err.code === "ENOENT"
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/storage/localProvider.test.ts`
Expected: PASS (all 6 cases).

- [ ] **Step 5: Commit**

```bash
git add src/storage/localProvider.ts src/storage/localProvider.test.ts
git commit -m "feat: add LocalStorageProvider for local filesystem sync"
```

---

### Task 3: Wire `local` provider into `createStorageProvider`

**Files:**
- Modify: `src/cli/createStorageProvider.ts`
- Test: `src/cli/createStorageProvider.test.ts`

**Interfaces:**
- Consumes: `Destination` type from `src/config/schema.ts` (now has optional `path?: string`, from Task 1), `LocalStorageProvider` from `src/storage/localProvider.ts` (from Task 2).
- Produces: `createStorageProvider(destination: Destination): StorageProvider` now also handles `destination.provider === "local"`.

- [ ] **Step 1: Write the failing test**

Add this case to `src/cli/createStorageProvider.test.ts`, inside the existing `describe("createStorageProvider", ...)` block:

```ts
  it("creates a LocalStorageProvider for provider: local", () => {
    const provider = createStorageProvider({
      provider: "local",
      path: "/tmp/some-dir",
      prefix: "p",
    });

    expect(provider).toBeInstanceOf(LocalStorageProvider);
  });
```

Add the import at the top of the file alongside the existing provider imports:

```ts
import { LocalStorageProvider } from "../storage/localProvider.js";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/cli/createStorageProvider.test.ts`
Expected: FAIL — `createStorageProvider` returns an `S3StorageProvider` (current code falls through to the S3 branch for any non-`"gcs"` provider), so `toBeInstanceOf(LocalStorageProvider)` fails.

- [ ] **Step 3: Update the implementation**

Replace the body of `src/cli/createStorageProvider.ts`:

```ts
import { S3Client } from "@aws-sdk/client-s3";
import { Storage } from "@google-cloud/storage";
import type { Destination } from "../config/schema.js";
import { GcsStorageProvider } from "../storage/gcsProvider.js";
import { LocalStorageProvider } from "../storage/localProvider.js";
import type { StorageProvider } from "../storage/StorageProvider.js";
import { S3StorageProvider } from "../storage/s3Provider.js";

export function createStorageProvider(
  destination: Destination,
): StorageProvider {
  if (destination.provider === "gcs") {
    return new GcsStorageProvider(
      new Storage(),
      destination.bucket!,
      destination.prefix,
    );
  }
  if (destination.provider === "local") {
    return new LocalStorageProvider(destination.path!, destination.prefix);
  }
  return new S3StorageProvider(
    new S3Client({ region: destination.region }),
    destination.bucket!,
    destination.prefix,
  );
}
```

The `!` non-null assertions on `bucket`/`path` are safe here: the Zod `superRefine` added in Task 1 guarantees `bucket` is present when `provider` is `"gcs"`/`"s3"`, and `path` is present when `provider` is `"local"`, before `createStorageProvider` is ever called with data from `loadConfig`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/cli/createStorageProvider.test.ts`
Expected: PASS (all 3 cases: gcs, s3, local).

- [ ] **Step 5: Typecheck and run the full test suite**

Run: `pnpm build && pnpm test`
Expected: Both succeed with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/cli/createStorageProvider.ts src/cli/createStorageProvider.test.ts
git commit -m "feat: wire local provider into createStorageProvider"
```

---

### Task 4: Document the `local` provider in README

**Files:**
- Modify: `README.md`

**Interfaces:** None (documentation only).

- [ ] **Step 1: Add a `local` mapping example to the config section**

In `README.md`, in the `## 設定ファイル` section, extend the existing YAML example (currently showing `gcs` and `s3` mappings) by appending a third mapping:

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

Directly below the code block, add a short note (matching the existing terse doc style):

```markdown
`provider: local`の場合は`bucket`の代わりに`path`(保存先ディレクトリ)を指定する。ディレクトリが存在しない場合は自動作成される。
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document local provider config"
```

---

## Final Verification

- [ ] **Step 1: Run the full suite one more time**

Run: `pnpm build && pnpm test && pnpm lint`
Expected: All pass with no errors or lint warnings.
