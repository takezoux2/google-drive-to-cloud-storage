import type { Storage } from "@google-cloud/storage";
import type { StorageProvider, UploadParams } from "./StorageProvider.js";

export class GcsStorageProvider implements StorageProvider {
  constructor(
    private readonly storage: Storage,
    private readonly bucket: string,
    private readonly prefix: string = "",
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
