import { describe, expect, it } from "vitest";
import { GcsStorageProvider } from "../storage/gcsProvider.js";
import { LocalStorageProvider } from "../storage/localProvider.js";
import { S3StorageProvider } from "../storage/s3Provider.js";
import { createStorageProvider } from "./createStorageProvider.js";

describe("createStorageProvider", () => {
  it("creates a GcsStorageProvider for provider: gcs", () => {
    const provider = createStorageProvider({
      provider: "gcs",
      bucket: "b",
      prefix: "p",
    });

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

  it("creates a LocalStorageProvider for provider: local", () => {
    const provider = createStorageProvider({
      provider: "local",
      path: "/tmp/some-dir",
      prefix: "p",
    });

    expect(provider).toBeInstanceOf(LocalStorageProvider);
  });
});
