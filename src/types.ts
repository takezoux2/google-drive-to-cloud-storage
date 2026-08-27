export type ConversionKind =
  | "google-doc-to-markdown"
  | "google-sheet-to-csv"
  | "image-convert-to-jpeg"
  | "copy"
  | "excluded";

export interface DriveFileInfo {
  id: string;
  /** Rename-applied output name, not necessarily the original Drive file name — see `applyRename` in `listFiles.ts`. */
  name: string;
  mimeType: string;
  modifiedTime: string;
  path: string;
  parents: string[];
  /** Drive上の共有URL(`webViewLink`)。取得できなかった場合はundefined。 */
  webViewLink?: string;
}

export interface ClassifiedFile extends DriveFileInfo {
  conversionKind: ConversionKind;
}

export interface MetadataFileEntry {
  path: string;
  sourcePath: string;
  originUrl: string;
  linkUrl: string;
  modifiedTime: string;
}

export interface SyncMetadata {
  files: MetadataFileEntry[];
  updatedAt: string;
}

export interface DiffResult {
  toUpload: ClassifiedFile[];
  toDelete: MetadataFileEntry[];
}
