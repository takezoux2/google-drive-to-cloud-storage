import type { drive_v3 } from "googleapis";
import type { ClassifiedFile } from "../types.js";
import { classifyMimeType } from "./convert/classify.js";

const FOLDER_MIME = "application/vnd.google-apps.folder";

export async function listFilesRecursively(
  drive: drive_v3.Drive,
  rootFolderId: string,
): Promise<ClassifiedFile[]> {
  const result: ClassifiedFile[] = [];
  await walk(drive, rootFolderId, "", result);
  return result;
}

async function walk(
  drive: drive_v3.Drive,
  folderId: string,
  pathPrefix: string,
  result: ClassifiedFile[],
): Promise<void> {
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, modifiedTime, parents)",
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const files = res.data.files ?? [];
    for (const file of files) {
      if (!file.id || !file.name || !file.mimeType || !file.modifiedTime)
        continue;
      const path = pathPrefix ? `${pathPrefix}/${file.name}` : file.name;
      if (file.mimeType === FOLDER_MIME) {
        await walk(drive, file.id, path, result);
      } else {
        result.push({
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          modifiedTime: file.modifiedTime,
          path,
          parents: file.parents ?? [],
          conversionKind: classifyMimeType(file.mimeType),
        });
      }
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
}
