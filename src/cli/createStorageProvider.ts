import { S3Client } from "@aws-sdk/client-s3";
import { Storage } from "@google-cloud/storage";
import type { Destination } from "../config/schema.js";
import { GcsStorageProvider } from "../storage/gcsProvider.js";
import type { StorageProvider } from "../storage/StorageProvider.js";
import { S3StorageProvider } from "../storage/s3Provider.js";

export function createStorageProvider(
  destination: Destination,
): StorageProvider {
  if (destination.provider === "gcs") {
    return new GcsStorageProvider(
      new Storage(),
      destination.bucket,
      destination.prefix,
    );
  }
  return new S3StorageProvider(
    new S3Client({ region: destination.region }),
    destination.bucket,
    destination.prefix,
  );
}
