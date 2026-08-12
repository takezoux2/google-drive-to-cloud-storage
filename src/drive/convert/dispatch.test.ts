import type { docs_v1, drive_v3, sheets_v4 } from "googleapis";
import { describe, expect, it, vi } from "vitest";
import type { ClassifiedFile } from "../../types.js";

vi.mock("./docs.js", () => ({
  convertDocToMarkdown: vi.fn().mockReturnValue("# Markdown"),
}));
vi.mock("./sheets.js", () => ({
  convertSpreadsheetToCsvFiles: vi.fn().mockResolvedValue(
    new Map([
      ["Sheet1", "a,b"],
      ["Sheet 2", "c,d"],
    ]),
  ),
}));
vi.mock("./image.js", () => ({
  convertToJpeg: vi.fn().mockResolvedValue(Buffer.from("jpeg-bytes")),
}));

import { convertFile } from "./dispatch.js";

function baseFile(overrides: Partial<ClassifiedFile>): ClassifiedFile {
  return {
    id: "file-id",
    name: "name",
    mimeType: "text/plain",
    modifiedTime: "2026-08-01T00:00:00.000Z",
    path: "path/name",
    parents: [],
    conversionKind: "copy",
    ...overrides,
  };
}

describe("convertFile", () => {
  it("converts a Google Doc to a single markdown output", async () => {
    const docs = {
      documents: { get: vi.fn().mockResolvedValue({ data: {} }) },
    } as unknown as docs_v1.Docs;
    const deps = {
      drive: {} as drive_v3.Drive,
      docs,
      sheets: {} as sheets_v4.Sheets,
    };
    const file = baseFile({
      conversionKind: "google-doc-to-markdown",
      path: "docs/report",
    });

    const outputs = await convertFile(file, deps);

    expect(outputs).toEqual([
      {
        outputPath: "docs/report.md",
        data: Buffer.from("# Markdown"),
        contentType: "text/markdown",
      },
    ]);
  });

  it("converts a Google Sheet to one CSV output per sheet", async () => {
    const sheets = {} as sheets_v4.Sheets;
    const deps = {
      drive: {} as drive_v3.Drive,
      docs: {} as docs_v1.Docs,
      sheets,
    };
    const file = baseFile({
      conversionKind: "google-sheet-to-csv",
      path: "sheets/sales",
    });

    const outputs = await convertFile(file, deps);

    expect(outputs).toEqual([
      {
        outputPath: "sheets/sales/Sheet1.csv",
        data: Buffer.from("a,b"),
        contentType: "text/csv",
      },
      {
        outputPath: "sheets/sales/Sheet 2.csv",
        data: Buffer.from("c,d"),
        contentType: "text/csv",
      },
    ]);
  });

  it("downloads and converts webp/heic images to jpeg", async () => {
    const drive = {
      files: {
        get: vi
          .fn()
          .mockResolvedValue({ data: new Uint8Array([9, 9, 9]).buffer }),
      },
    } as unknown as drive_v3.Drive;
    const deps = {
      drive,
      docs: {} as docs_v1.Docs,
      sheets: {} as sheets_v4.Sheets,
    };
    const file = baseFile({
      conversionKind: "image-convert-to-jpeg",
      path: "images/photo.webp",
      mimeType: "image/webp",
    });

    const outputs = await convertFile(file, deps);

    expect(outputs).toEqual([
      {
        outputPath: "images/photo.jpg",
        data: Buffer.from("jpeg-bytes"),
        contentType: "image/jpeg",
      },
    ]);
  });

  it("downloads and copies other files as-is", async () => {
    const drive = {
      files: {
        get: vi
          .fn()
          .mockResolvedValue({ data: new Uint8Array([1, 2, 3]).buffer }),
      },
    } as unknown as drive_v3.Drive;
    const deps = {
      drive,
      docs: {} as docs_v1.Docs,
      sheets: {} as sheets_v4.Sheets,
    };
    const file = baseFile({
      conversionKind: "copy",
      path: "files/doc.pdf",
      mimeType: "application/pdf",
    });

    const outputs = await convertFile(file, deps);

    expect(outputs).toEqual([
      {
        outputPath: "files/doc.pdf",
        data: Buffer.from([1, 2, 3]),
        contentType: "application/pdf",
      },
    ]);
  });

  it("returns no outputs for excluded files", async () => {
    const deps = {
      drive: {} as drive_v3.Drive,
      docs: {} as docs_v1.Docs,
      sheets: {} as sheets_v4.Sheets,
    };
    const file = baseFile({ conversionKind: "excluded" });

    const outputs = await convertFile(file, deps);

    expect(outputs).toEqual([]);
  });
});
