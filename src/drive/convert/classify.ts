import type { ConversionKind } from "../../types.js";

const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const GOOGLE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const GOOGLE_SLIDES_MIME = "application/vnd.google-apps.presentation";

const CONVERT_TO_JPEG_MIME_TYPES = new Set(["image/webp", "image/heic"]);

const COPY_AS_IS_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/xml",
  "application/xml",
  "application/json",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/svg+xml",
]);

export function classifyMimeType(mimeType: string): ConversionKind {
  if (mimeType === GOOGLE_DOC_MIME) return "google-doc-to-markdown";
  if (mimeType === GOOGLE_SHEET_MIME) return "google-sheet-to-csv";
  if (mimeType === GOOGLE_SLIDES_MIME) return "excluded";
  if (CONVERT_TO_JPEG_MIME_TYPES.has(mimeType)) return "image-convert-to-jpeg";
  if (COPY_AS_IS_MIME_TYPES.has(mimeType)) return "copy";
  return "excluded";
}
