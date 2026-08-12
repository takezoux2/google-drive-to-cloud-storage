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
        {
          path: "keep.txt",
          sourcePath: "keep.txt",
          originUrl: "https://drive.google.com/open?id=keep",
          linkUrl: "https://drive.google.com/open?id=keep",
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
    const keepFile: ClassifiedFile = {
      id: "id-keep",
      name: "keep.txt",
      mimeType: "text/plain",
      modifiedTime: "2026-08-01T00:00:00.000Z",
      path: "keep.txt",
      parents: [],
      conversionKind: "copy",
    };
    listFilesRecursively.mockResolvedValue([keepFile]);

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

  it("does not delete a key that was just uploaded in the same run", async () => {
    const storage = new FakeStorageProvider();
    const existingMetadata: SyncMetadata = {
      files: [
        {
          path: "photo.jpg",
          sourcePath: "photo.webp",
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
    await storage.upload({
      key: "photo.jpg",
      data: Buffer.from("old-jpg-bytes"),
      contentType: "image/jpeg",
    });
    const newFile: ClassifiedFile = {
      id: "id-new",
      name: "photo.jpg",
      mimeType: "image/jpeg",
      modifiedTime: "2026-08-10T00:00:00.000Z",
      path: "photo.jpg",
      parents: [],
      conversionKind: "copy",
    };
    listFilesRecursively.mockResolvedValue([newFile]);
    convertFile.mockResolvedValue([
      {
        outputPath: "photo.jpg",
        data: Buffer.from("new-jpg-bytes"),
        contentType: "image/jpeg",
      },
    ]);

    const result = await syncMapping("folder-id", fakeDeps(storage));

    expect(storage.deleteCalls).toEqual([]);
    expect(result.deleted).toEqual([]);
    expect(storage.store.get("photo.jpg")?.toString()).toBe("new-jpg-bytes");

    const metadata = JSON.parse(
      storage.store.get("metadata.json")?.toString() ?? "{}",
    ) as SyncMetadata;
    expect(metadata.files).toEqual([
      {
        path: "photo.jpg",
        sourcePath: "photo.jpg",
        originUrl: "https://drive.google.com/open?id=id-new",
        linkUrl: "https://drive.google.com/open?id=id-new",
        modifiedTime: "2026-08-10T00:00:00.000Z",
      },
    ]);
  });

  it("records no entries for a source file when only some of its outputs upload successfully", async () => {
    class PartiallyFailingStorage extends FakeStorageProvider {
      async upload(params: UploadParams): Promise<void> {
        if (params.key === "sheet/Sheet2.csv") {
          throw new Error("upload failed");
        }
        await super.upload(params);
      }
    }
    const storage = new PartiallyFailingStorage();
    const file: ClassifiedFile = {
      id: "id-sheet",
      name: "sheet",
      mimeType: "application/vnd.google-apps.spreadsheet",
      modifiedTime: "2026-08-01T00:00:00.000Z",
      path: "sheet",
      parents: [],
      conversionKind: "google-sheet-to-csv",
    };
    listFilesRecursively.mockResolvedValue([file]);
    convertFile.mockResolvedValue([
      {
        outputPath: "sheet/Sheet1.csv",
        data: Buffer.from("a,b"),
        contentType: "text/csv",
      },
      {
        outputPath: "sheet/Sheet2.csv",
        data: Buffer.from("c,d"),
        contentType: "text/csv",
      },
    ]);

    const result = await syncMapping("folder-id", fakeDeps(storage));

    expect(result.uploaded).toEqual([]);
    expect(result.failed).toEqual([
      { sourcePath: "sheet", error: "upload failed" },
    ]);

    const metadata = JSON.parse(
      storage.store.get("metadata.json")?.toString() ?? "{}",
    ) as SyncMetadata;
    expect(metadata.files).toEqual([]);
  });

  it("records a delete failure in result.failed without throwing", async () => {
    class DeleteFailingStorage extends FakeStorageProvider {
      async delete(_key: string): Promise<void> {
        throw new Error("delete failed");
      }
    }
    const storage = new DeleteFailingStorage();
    const existingMetadata: SyncMetadata = {
      files: [
        {
          path: "removed.txt",
          sourcePath: "removed.txt",
          originUrl: "https://drive.google.com/open?id=old",
          linkUrl: "https://drive.google.com/open?id=old",
          modifiedTime: "2026-08-01T00:00:00.000Z",
        },
        {
          path: "keep.txt",
          sourcePath: "keep.txt",
          originUrl: "https://drive.google.com/open?id=keep",
          linkUrl: "https://drive.google.com/open?id=keep",
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
    const keepFile: ClassifiedFile = {
      id: "id-keep",
      name: "keep.txt",
      mimeType: "text/plain",
      modifiedTime: "2026-08-01T00:00:00.000Z",
      path: "keep.txt",
      parents: [],
      conversionKind: "copy",
    };
    listFilesRecursively.mockResolvedValue([keepFile]);

    const result = await syncMapping("folder-id", fakeDeps(storage));

    expect(result.deleted).toEqual([]);
    expect(result.failed).toEqual([
      { sourcePath: "removed.txt", error: "delete failed" },
    ]);
  });

  it("retains the metadata entry for a file whose delete fails, so it is retried next run", async () => {
    class SelectiveDeleteFailingStorage extends FakeStorageProvider {
      async delete(key: string): Promise<void> {
        if (key === "removed.txt") {
          throw new Error("delete failed");
        }
        await super.delete(key);
      }
    }
    const storage = new SelectiveDeleteFailingStorage();
    const removedEntry = {
      path: "removed.txt",
      sourcePath: "removed.txt",
      originUrl: "https://drive.google.com/open?id=old",
      linkUrl: "https://drive.google.com/open?id=old",
      modifiedTime: "2026-08-01T00:00:00.000Z",
    };
    const existingMetadata: SyncMetadata = {
      files: [
        removedEntry,
        {
          path: "keep.txt",
          sourcePath: "keep.txt",
          originUrl: "https://drive.google.com/open?id=keep",
          linkUrl: "https://drive.google.com/open?id=keep",
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
    const keepFile: ClassifiedFile = {
      id: "id-keep",
      name: "keep.txt",
      mimeType: "text/plain",
      modifiedTime: "2026-08-01T00:00:00.000Z",
      path: "keep.txt",
      parents: [],
      conversionKind: "copy",
    };
    listFilesRecursively.mockResolvedValue([keepFile]);

    const result = await syncMapping("folder-id", fakeDeps(storage));

    expect(result.failed).toEqual([
      { sourcePath: "removed.txt", error: "delete failed" },
    ]);

    const metadata = JSON.parse(
      storage.store.get("metadata.json")?.toString() ?? "{}",
    ) as SyncMetadata;
    expect(metadata.files).toContainEqual(removedEntry);
  });

  it("records a writeMetadata failure in result.failed without throwing", async () => {
    class MetadataFailingStorage extends FakeStorageProvider {
      async upload(params: UploadParams): Promise<void> {
        if (params.key === "metadata.json") {
          throw new Error("write failed");
        }
        await super.upload(params);
      }
    }
    const storage = new MetadataFailingStorage();
    const file: ClassifiedFile = {
      id: "id-1",
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

    const result = await syncMapping("folder-id", fakeDeps(storage));

    expect(result.uploaded).toEqual(["new.txt"]);
    expect(result.failed).toEqual([
      { sourcePath: "metadata.json", error: "write failed" },
    ]);
  });

  it("aborts without deleting anything when Drive listing is empty but metadata has tracked files", async () => {
    const storage = new FakeStorageProvider();
    const existingMetadata: SyncMetadata = {
      files: [
        {
          path: "a.txt",
          sourcePath: "a.txt",
          originUrl: "https://drive.google.com/open?id=a",
          linkUrl: "https://drive.google.com/open?id=a",
          modifiedTime: "2026-08-01T00:00:00.000Z",
        },
        {
          path: "b.txt",
          sourcePath: "b.txt",
          originUrl: "https://drive.google.com/open?id=b",
          linkUrl: "https://drive.google.com/open?id=b",
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

    expect(result.deleted).toEqual([]);
    expect(result.uploaded).toEqual([]);
    expect(storage.deleteCalls).toEqual([]);
    expect(result.failed).toEqual([
      {
        sourcePath: "<all>",
        error:
          "Drive listing returned 0 files but metadata has 2 tracked files; aborting to avoid mass deletion. If the folder is genuinely empty, delete metadata.json manually to confirm.",
      },
    ]);

    const metadataAfter = JSON.parse(
      storage.store.get("metadata.json")?.toString() ?? "{}",
    ) as SyncMetadata;
    expect(metadataAfter.files).toHaveLength(2);
  });
});
