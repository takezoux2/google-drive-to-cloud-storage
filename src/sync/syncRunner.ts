import type { docs_v1, drive_v3, sheets_v4 } from "googleapis";
import type {
  ExcludeConfig,
  IncludeConfig,
  RenameRule,
} from "../config/schema.js";
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
  excluded: string[];
}

export async function syncMapping(
  driveFolderId: string,
  deps: SyncMappingDeps,
  exclude?: ExcludeConfig,
  include?: IncludeConfig,
  rename?: RenameRule[],
  matchedRenameIndices?: Set<number>,
): Promise<SyncMappingResult> {
  const result: SyncMappingResult = {
    uploaded: [],
    deleted: [],
    failed: [],
    excluded: [],
  };

  const driveFiles = await listFilesRecursively(
    deps.drive,
    driveFolderId,
    exclude,
    include,
    rename,
    matchedRenameIndices,
  );
  const metadata = await readMetadata(deps.storage);

  result.excluded = driveFiles
    .filter((f) => f.conversionKind === "excluded")
    .map((f) => f.path);

  const activeFileCount = driveFiles.filter(
    (f) => f.conversionKind !== "excluded",
  ).length;
  if (activeFileCount === 0 && metadata.files.length > 0) {
    result.failed.push({
      sourcePath: "<all>",
      error: `Drive listing returned 0 active files (after MIME-type/exclude filtering) but metadata has ${metadata.files.length} tracked files; aborting to avoid mass deletion. If the folder is genuinely empty, or an "exclude" rule now matches everything, delete metadata.json manually to confirm.`,
    });
    return result;
  }

  const { toUpload, toDelete } = diffFiles(driveFiles, metadata);

  const toUploadPaths = new Set(toUpload.map((f) => f.path));
  for (const file of driveFiles) {
    if (toUploadPaths.has(file.path)) continue;
    const reason =
      file.conversionKind === "excluded" ? "excluded" : "up to date";
    console.log(`Skipped: ${file.path} (${reason})`);
  }

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
      console.log(`Uploaded: ${file.path}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.failed.push({ sourcePath: file.path, error: message });
      console.log(`Skipped: ${file.path} (failed: ${message})`);
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
        entries.push(entry);
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
