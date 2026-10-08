import type { docs_v1, drive_v3, sheets_v4 } from "googleapis";
import type { ClassifiedFile } from "../../types.js";
import { convertDocToMarkdown } from "./docs.js";
import { convertToJpeg } from "./image.js";
import { convertSpreadsheetToCsvFiles } from "./sheets.js";

export interface ConversionOutput {
  outputPath: string;
  data: Buffer;
  contentType: string;
}

export interface ConvertDeps {
  drive: drive_v3.Drive;
  docs: docs_v1.Docs;
  sheets: sheets_v4.Sheets;
}

export async function convertFile(
  file: ClassifiedFile,
  deps: ConvertDeps,
): Promise<ConversionOutput[]> {
  switch (file.conversionKind) {
    case "google-doc-to-markdown": {
      const res = await deps.docs.documents.get({ documentId: file.id });
      const markdown = convertDocToMarkdown(res.data);
      return [
        {
          outputPath: /\.md$/i.test(file.path) ? file.path : `${file.path}.md`,
          data: Buffer.from(markdown, "utf-8"),
          contentType: "text/markdown",
        },
      ];
    }
    case "google-sheet-to-csv": {
      const csvBySheet = await convertSpreadsheetToCsvFiles(
        deps.sheets,
        file.id,
      );
      return Array.from(csvBySheet.entries()).map(([sheetTitle, csv]) => ({
        outputPath: `${file.path}/${sanitizeForPath(sheetTitle)}.csv`,
        data: Buffer.from(csv, "utf-8"),
        contentType: "text/csv",
      }));
    }
    case "image-convert-to-jpeg": {
      const raw = await downloadDriveFile(deps.drive, file.id);
      const jpeg = await convertToJpeg(raw);
      const newPath = file.path.replace(/\.[^./]+$/, ".jpg");
      return [{ outputPath: newPath, data: jpeg, contentType: "image/jpeg" }];
    }
    case "copy": {
      const raw = await downloadDriveFile(deps.drive, file.id);
      return [{ outputPath: file.path, data: raw, contentType: file.mimeType }];
    }
    case "excluded":
      return [];
  }
}

function sanitizeForPath(name: string): string {
  return name.replace(/[/\\]/g, "_");
}

async function downloadDriveFile(
  drive: drive_v3.Drive,
  fileId: string,
): Promise<Buffer> {
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" },
  );
  return Buffer.from(res.data as ArrayBuffer);
}
