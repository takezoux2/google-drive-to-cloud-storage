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
