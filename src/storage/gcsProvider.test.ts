import type { Storage } from "@google-cloud/storage";
import { describe, expect, it, vi } from "vitest";
import { GcsStorageProvider } from "./gcsProvider.js";

function createFakeStorage() {
  const file = {
    save: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue([true]),
    download: vi.fn().mockResolvedValue([Buffer.from("content")]),
  };
  const bucket = vi
    .fn()
    .mockReturnValue({ file: vi.fn().mockReturnValue(file) });
  return { storage: { bucket } as unknown as Storage, bucket, file };
}

describe("GcsStorageProvider", () => {
  it("uploads with the prefix applied", async () => {
    const { storage, bucket, file } = createFakeStorage();
    const provider = new GcsStorageProvider(storage, "my-bucket", "backups");

    await provider.upload({
      key: "a.txt",
      data: Buffer.from("x"),
      contentType: "text/plain",
    });

    expect(bucket).toHaveBeenCalledWith("my-bucket");
    expect(file.save).toHaveBeenCalledWith(Buffer.from("x"), {
      contentType: "text/plain",
    });
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
