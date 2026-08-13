import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StorageProvider, UploadParams } from "./StorageProvider.js";

export class LocalStorageProvider implements StorageProvider {
  constructor(
    private readonly basePath: string,
    private readonly prefix: string = "",
  ) {}

  private resolveKey(key: string): string {
    const root = path.resolve(this.basePath, this.prefix);
    const resolved = path.resolve(root, key);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error(`key escapes the destination directory: ${key}`);
    }
    return resolved;
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
