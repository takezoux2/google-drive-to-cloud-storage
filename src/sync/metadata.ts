import type { StorageProvider } from "../storage/StorageProvider.js";
import type { SyncMetadata } from "../types.js";

const METADATA_KEY = "metadata.json";

export async function readMetadata(
  storage: StorageProvider,
): Promise<SyncMetadata> {
  const buf = await storage.download(METADATA_KEY);
  if (!buf) {
    return { files: [], updatedAt: new Date(0).toISOString() };
  }
  return JSON.parse(buf.toString("utf-8")) as SyncMetadata;
}

export async function writeMetadata(
  storage: StorageProvider,
  metadata: SyncMetadata,
): Promise<void> {
  const data = Buffer.from(JSON.stringify(metadata, null, 2), "utf-8");
  await storage.upload({
    key: METADATA_KEY,
    data,
    contentType: "application/json",
  });
}
