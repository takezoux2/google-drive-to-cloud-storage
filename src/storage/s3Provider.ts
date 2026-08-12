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
    private readonly prefix: string = "",
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
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: this.resolveKey(key),
      }),
    );
  }

  async download(key: string): Promise<Buffer | undefined> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.resolveKey(key),
        }),
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
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    err.name === "NoSuchKey"
  );
}
