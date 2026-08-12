import type { docs_v1, drive_v3, sheets_v4 } from "googleapis";
import { convertFile } from "../drive/convert/dispatch.js";
import { listFilesRecursively } from "../drive/listFiles.js";
import type { StorageProvider } from "../storage/StorageProvider.js";
import type { MetadataFileEntry, SyncMetadata } from "../types.js";
import { diffFiles } from "./diff.js";
import { readMetadata, writeMetadata } from "./metadata.js";

export interface SyncMappingDeps {
  drive: drive_v3.Drive;
  docs: docs_v1.Docs;
  sheets: sheets_v4.Sheets;
  storage: StorageProvider;
  dryRun: boolean;
}

export interface SyncMappingResult {
  uploaded: string[];
  deleted: string[];
  failed: { sourcePath: string; error: string }[];
}

export async function syncMapping(
  driveFolderId: string,
  deps: SyncMappingDeps,
): Promise<SyncMappingResult> {
  const result: SyncMappingResult = { uploaded: [], deleted: [], failed: [] };

  const driveFiles = await listFilesRecursively(deps.drive, driveFolderId);
  const metadata = await readMetadata(deps.storage);
  const { toUpload, toDelete } = diffFiles(driveFiles, metadata);

  const deletedPaths = new Set(toDelete.map((d) => d.path));
  const reuploadSourcePaths = new Set(toUpload.map((f) => f.path));
  const entries: MetadataFileEntry[] = metadata.files.filter(
    (entry) =>
      !deletedPaths.has(entry.path) &&
      !reuploadSourcePaths.has(entry.sourcePath),
  );

  for (const file of toUpload) {
    try {
      const outputs = await convertFile(file, deps);
      for (const output of outputs) {
        if (!deps.dryRun) {
          await deps.storage.upload({
            key: output.outputPath,
            data: output.data,
            contentType: output.contentType,
          });
        }
        result.uploaded.push(output.outputPath);
        const url = `https://drive.google.com/open?id=${file.id}`;
        entries.push({
          path: output.outputPath,
          sourcePath: file.path,
          originUrl: url,
          linkUrl: url,
          modifiedTime: file.modifiedTime,
        });
      }
    } catch (err) {
      result.failed.push({
        sourcePath: file.path,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  for (const entry of toDelete) {
    if (!deps.dryRun) {
      await deps.storage.delete(entry.path);
    }
    result.deleted.push(entry.path);
  }

  if (!deps.dryRun) {
    const newMetadata: SyncMetadata = {
      files: entries,
      updatedAt: new Date().toISOString(),
    };
    await writeMetadata(deps.storage, newMetadata);
  }

  return result;
}
