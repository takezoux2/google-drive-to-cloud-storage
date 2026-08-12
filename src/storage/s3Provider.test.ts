import type { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { S3StorageProvider } from "./s3Provider.js";

describe("S3StorageProvider", () => {
  it("uploads with the prefix applied via PutObjectCommand", async () => {
    const send = vi.fn().mockResolvedValue({});
    const client = { send } as unknown as S3Client;
    const provider = new S3StorageProvider(client, "my-bucket", "backups");

    await provider.upload({
      key: "a.txt",
      data: Buffer.from("x"),
      contentType: "text/plain",
    });

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0];
    expect(command.input).toEqual({
      Bucket: "my-bucket",
      Key: "backups/a.txt",
      Body: Buffer.from("x"),
      ContentType: "text/plain",
    });
  });

  it("deletes with the prefix applied via DeleteObjectCommand", async () => {
    const send = vi.fn().mockResolvedValue({});
    const client = { send } as unknown as S3Client;
    const provider = new S3StorageProvider(client, "my-bucket", "backups");

    await provider.delete("a.txt");

    const command = send.mock.calls[0][0];
    expect(command.input).toEqual({
      Bucket: "my-bucket",
      Key: "backups/a.txt",
    });
  });

  it("downloads existing content via GetObjectCommand", async () => {
    const send = vi.fn().mockResolvedValue({
      Body: {
        transformToByteArray: () => Promise.resolve(new Uint8Array([1, 2, 3])),
      },
    });
    const client = { send } as unknown as S3Client;
    const provider = new S3StorageProvider(client, "my-bucket");

    const result = await provider.download("a.txt");

    expect(result).toEqual(Buffer.from([1, 2, 3]));
  });

  it("returns undefined when the object does not exist", async () => {
    const error = Object.assign(new Error("not found"), { name: "NoSuchKey" });
    const send = vi.fn().mockRejectedValue(error);
    const client = { send } as unknown as S3Client;
    const provider = new S3StorageProvider(client, "my-bucket");

    const result = await provider.download("missing.txt");

    expect(result).toBeUndefined();
  });
});
