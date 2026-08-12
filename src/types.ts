export type ConversionKind =
  | "google-doc-to-markdown"
  | "google-sheet-to-csv"
  | "image-convert-to-jpeg"
  | "copy"
  | "excluded";

export interface DriveFileInfo {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  path: string;
  parents: string[];
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
