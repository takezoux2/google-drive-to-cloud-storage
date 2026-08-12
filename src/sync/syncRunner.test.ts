import { describe, expect, it, vi } from "vitest";
import type {
  StorageProvider,
  UploadParams,
} from "../storage/StorageProvider.js";
import type { ClassifiedFile, SyncMetadata } from "../types.js";

const { listFilesRecursively, convertFile } = vi.hoisted(() => {
  const listFilesRecursively = vi.fn();
  const convertFile = vi.fn();
  return { listFilesRecursively, convertFile };
});

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
      {
        outputPath: "report.md",
        data: Buffer.from("# R"),
        contentType: "text/markdown",
      },
    ]);

    const result = await syncMapping("folder-id", fakeDeps(storage));

    expect(result.uploaded).toEqual(["report.md"]);
    expect(result.deleted).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(storage.store.get("report.md")?.toString()).toBe("# R");

    const metadata = JSON.parse(
      storage.store.get("metadata.json")?.toString() ?? "{}",
    ) as SyncMetadata;
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

    expect(result.failed).toEqual([
      { sourcePath: "broken.txt", error: "download failed" },
    ]);
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
      {
        outputPath: "new.txt",
        data: Buffer.from("x"),
        contentType: "text/plain",
      },
    ]);

    const result = await syncMapping("folder-id", fakeDeps(storage, true));

    expect(result.uploaded).toEqual(["new.txt"]);
    expect(storage.store.has("new.txt")).toBe(false);
    expect(storage.store.has("metadata.json")).toBe(false);
  });
});
