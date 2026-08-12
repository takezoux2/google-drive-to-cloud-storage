import { describe, expect, it } from "vitest";
import type {
  StorageProvider,
  UploadParams,
} from "../storage/StorageProvider.js";
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
