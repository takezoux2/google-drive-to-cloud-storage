import { describe, expect, it } from "vitest";
import type { ClassifiedFile, SyncMetadata } from "../types.js";
import { diffFiles } from "./diff.js";

function makeFile(overrides: Partial<ClassifiedFile>): ClassifiedFile {
  return {
    id: "id-1",
    name: "file.txt",
    mimeType: "text/plain",
    modifiedTime: "2026-08-01T00:00:00.000Z",
    path: "file.txt",
    parents: [],
    conversionKind: "copy",
    ...overrides,
  };
}

describe("diffFiles", () => {
  it("marks a new file as toUpload", () => {
    const driveFiles = [makeFile({ path: "new.txt" })];
    const metadata: SyncMetadata = {
      files: [],
      updatedAt: "2026-08-01T00:00:00.000Z",
    };

    const result = diffFiles(driveFiles, metadata);

    expect(result.toUpload).toHaveLength(1);
    expect(result.toUpload[0].path).toBe("new.txt");
    expect(result.toDelete).toHaveLength(0);
  });

  it("marks an updated file (newer modifiedTime) as toUpload", () => {
    const driveFiles = [
      makeFile({
        path: "existing.txt",
        modifiedTime: "2026-08-10T00:00:00.000Z",
      }),
    ];
    const metadata: SyncMetadata = {
      files: [
        {
          path: "existing.txt",
          sourcePath: "existing.txt",
          originUrl: "https://drive.google.com/open?id=id-1",
          linkUrl: "https://drive.google.com/open?id=id-1",
          modifiedTime: "2026-08-01T00:00:00.000Z",
        },
      ],
      updatedAt: "2026-08-01T00:00:00.000Z",
    };

    const result = diffFiles(driveFiles, metadata);

    expect(result.toUpload).toHaveLength(1);
  });

  it("does not re-upload an unchanged file", () => {
    const driveFiles = [
      makeFile({ path: "same.txt", modifiedTime: "2026-08-01T00:00:00.000Z" }),
    ];
    const metadata: SyncMetadata = {
      files: [
        {
          path: "same.txt",
          sourcePath: "same.txt",
          originUrl: "https://drive.google.com/open?id=id-1",
          linkUrl: "https://drive.google.com/open?id=id-1",
          modifiedTime: "2026-08-01T00:00:00.000Z",
        },
      ],
      updatedAt: "2026-08-01T00:00:00.000Z",
    };

    const result = diffFiles(driveFiles, metadata);

    expect(result.toUpload).toHaveLength(0);
  });

  it("marks a metadata entry as toDelete when its source is gone from Drive", () => {
    const driveFiles: ClassifiedFile[] = [];
    const metadata: SyncMetadata = {
      files: [
        {
          path: "removed.txt",
          sourcePath: "removed.txt",
          originUrl: "https://drive.google.com/open?id=id-2",
          linkUrl: "https://drive.google.com/open?id=id-2",
          modifiedTime: "2026-08-01T00:00:00.000Z",
        },
      ],
      updatedAt: "2026-08-01T00:00:00.000Z",
    };

    const result = diffFiles(driveFiles, metadata);

    expect(result.toDelete).toHaveLength(1);
    expect(result.toDelete[0].path).toBe("removed.txt");
  });

  it("excludes files classified as excluded from upload and treats them as absent for deletion", () => {
    const driveFiles = [
      makeFile({ path: "slides.gslides", conversionKind: "excluded" }),
    ];
    const metadata: SyncMetadata = {
      files: [],
      updatedAt: "2026-08-01T00:00:00.000Z",
    };

    const result = diffFiles(driveFiles, metadata);

    expect(result.toUpload).toHaveLength(0);
  });

  it("marks a previously synced file as toDelete when it now appears as excluded", () => {
    const driveFiles = [
      makeFile({ path: "slides.gslides", conversionKind: "excluded" }),
    ];
    const metadata: SyncMetadata = {
      files: [
        {
          path: "slides.gslides",
          sourcePath: "slides.gslides",
          originUrl: "https://drive.google.com/open?id=id-3",
          linkUrl: "https://drive.google.com/open?id=id-3",
          modifiedTime: "2026-08-01T00:00:00.000Z",
        },
      ],
      updatedAt: "2026-08-01T00:00:00.000Z",
    };

    const result = diffFiles(driveFiles, metadata);

    expect(result.toDelete).toHaveLength(1);
    expect(result.toDelete[0].path).toBe("slides.gslides");
    expect(result.toUpload).toHaveLength(0);
  });
});
