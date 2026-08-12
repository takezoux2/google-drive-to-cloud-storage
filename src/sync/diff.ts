import type { ClassifiedFile, DiffResult, SyncMetadata } from "../types.js";

export function diffFiles(
  driveFiles: ClassifiedFile[],
  metadata: SyncMetadata,
): DiffResult {
  const activeFiles = driveFiles.filter((f) => f.conversionKind !== "excluded");

  const latestModifiedBySourcePath = new Map<string, string>();
  for (const entry of metadata.files) {
    const current = latestModifiedBySourcePath.get(entry.sourcePath);
    if (
      !current ||
      new Date(entry.modifiedTime).getTime() > new Date(current).getTime()
    ) {
      latestModifiedBySourcePath.set(entry.sourcePath, entry.modifiedTime);
    }
  }

  const toUpload = activeFiles.filter((f) => {
    const existingModifiedTime = latestModifiedBySourcePath.get(f.path);
    if (!existingModifiedTime) return true;
    return (
      new Date(f.modifiedTime).getTime() >
      new Date(existingModifiedTime).getTime()
    );
  });

  const activeSourcePaths = new Set(activeFiles.map((f) => f.path));
  const toDelete = metadata.files.filter(
    (entry) => !activeSourcePaths.has(entry.sourcePath),
  );

  return { toUpload, toDelete };
}
