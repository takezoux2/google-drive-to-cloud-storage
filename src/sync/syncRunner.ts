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

  if (driveFiles.length === 0 && metadata.files.length > 0) {
    result.failed.push({
      sourcePath: "<all>",
      error: `Drive listing returned 0 files but metadata has ${metadata.files.length} tracked files; aborting to avoid mass deletion. If the folder is genuinely empty, delete metadata.json manually to confirm.`,
    });
    return result;
  }

  const { toUpload, toDelete } = diffFiles(driveFiles, metadata);

  const deletedPaths = new Set(toDelete.map((d) => d.path));
  const reuploadSourcePaths = new Set(toUpload.map((f) => f.path));
  const entries: MetadataFileEntry[] = metadata.files.filter(
    (entry) =>
      !deletedPaths.has(entry.path) &&
      !reuploadSourcePaths.has(entry.sourcePath),
  );

  const uploadedPaths = new Set<string>();

  for (const file of toUpload) {
    try {
      const outputs = await convertFile(file, deps);
      if (!deps.dryRun) {
        for (const output of outputs) {
          await deps.storage.upload({
            key: output.outputPath,
            data: output.data,
            contentType: output.contentType,
          });
        }
      }
      const url = `https://drive.google.com/open?id=${file.id}`;
      for (const output of outputs) {
        result.uploaded.push(output.outputPath);
        uploadedPaths.add(output.outputPath);
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
    if (uploadedPaths.has(entry.path)) continue;
    if (!deps.dryRun) {
      try {
        await deps.storage.delete(entry.path);
      } catch (err) {
        result.failed.push({
          sourcePath: entry.sourcePath,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
    }
    result.deleted.push(entry.path);
  }

  if (!deps.dryRun) {
    const newMetadata: SyncMetadata = {
      files: entries,
      updatedAt: new Date().toISOString(),
    };
    try {
      await writeMetadata(deps.storage, newMetadata);
    } catch (err) {
      result.failed.push({
        sourcePath: "metadata.json",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
