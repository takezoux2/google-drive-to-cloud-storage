import type { drive_v3 } from "googleapis";
import { describe, expect, it, vi } from "vitest";
import { listFilesRecursively } from "./listFiles.js";

describe("listFilesRecursively", () => {
  it("recursively walks subfolders and builds relative paths", async () => {
    const list = vi.fn().mockImplementation(({ q }: { q: string }) => {
      if (q.includes("'root'")) {
        return Promise.resolve({
          data: {
            files: [
              {
                id: "folder-1",
                name: "sub",
                mimeType: "application/vnd.google-apps.folder",
                modifiedTime: "2026-08-01T00:00:00.000Z",
                parents: ["root"],
              },
              {
                id: "file-1",
                name: "readme.txt",
                mimeType: "text/plain",
                modifiedTime: "2026-08-01T00:00:00.000Z",
                parents: ["root"],
              },
            ],
          },
        });
      }
      if (q.includes("'folder-1'")) {
        return Promise.resolve({
          data: {
            files: [
              {
                id: "file-2",
                name: "notes.txt",
                mimeType: "text/plain",
                modifiedTime: "2026-08-02T00:00:00.000Z",
                parents: ["folder-1"],
              },
            ],
          },
        });
      }
      return Promise.resolve({ data: { files: [] } });
    });
    const drive = { files: { list } } as unknown as drive_v3.Drive;

    const result = await listFilesRecursively(drive, "root");

    expect(result).toHaveLength(2);
    expect(result.find((f) => f.id === "file-1")?.path).toBe("readme.txt");
    expect(result.find((f) => f.id === "file-2")?.path).toBe("sub/notes.txt");
    expect(result.find((f) => f.id === "file-2")?.conversionKind).toBe("copy");
  });

  it("requests supportsAllDrives and includeItemsFromAllDrives so shared drive folders are included", async () => {
    const list = vi.fn().mockResolvedValue({ data: { files: [] } });
    const drive = { files: { list } } as unknown as drive_v3.Drive;

    await listFilesRecursively(drive, "root");

    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      }),
    );
  });

  it("excludes a file by fileId, marking it conversionKind excluded", async () => {
    const list = vi.fn().mockResolvedValue({
      data: {
        files: [
          {
            id: "file-excluded",
            name: "secret.txt",
            mimeType: "text/plain",
            modifiedTime: "2026-08-01T00:00:00.000Z",
            parents: ["root"],
          },
          {
            id: "file-kept",
            name: "keep.txt",
            mimeType: "text/plain",
            modifiedTime: "2026-08-01T00:00:00.000Z",
            parents: ["root"],
          },
        ],
      },
    });
    const drive = { files: { list } } as unknown as drive_v3.Drive;

    const result = await listFilesRecursively(drive, "root", {
      fileIds: ["file-excluded"],
    });

    expect(result).toHaveLength(2);
    expect(result.find((f) => f.id === "file-excluded")?.conversionKind).toBe(
      "excluded",
    );
    expect(result.find((f) => f.id === "file-kept")?.conversionKind).toBe(
      "copy",
    );
  });

  it("excludes a folder by fileId, skipping its entire subtree", async () => {
    const list = vi.fn().mockImplementation(({ q }: { q: string }) => {
      if (q.includes("'root'")) {
        return Promise.resolve({
          data: {
            files: [
              {
                id: "folder-excluded",
                name: "drafts",
                mimeType: "application/vnd.google-apps.folder",
                modifiedTime: "2026-08-01T00:00:00.000Z",
                parents: ["root"],
              },
            ],
          },
        });
      }
      return Promise.resolve({
        data: {
          files: [
            {
              id: "file-inside-excluded",
              name: "draft.txt",
              mimeType: "text/plain",
              modifiedTime: "2026-08-01T00:00:00.000Z",
              parents: ["folder-excluded"],
            },
          ],
        },
      });
    });
    const drive = { files: { list } } as unknown as drive_v3.Drive;

    const result = await listFilesRecursively(drive, "root", {
      fileIds: ["folder-excluded"],
    });

    expect(result).toHaveLength(0);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("excludes files and folders matching a namePattern regex", async () => {
    const list = vi.fn().mockImplementation(({ q }: { q: string }) => {
      if (q.includes("'root'")) {
        return Promise.resolve({
          data: {
            files: [
              {
                id: "folder-underscore",
                name: "_ignored",
                mimeType: "application/vnd.google-apps.folder",
                modifiedTime: "2026-08-01T00:00:00.000Z",
                parents: ["root"],
              },
              {
                id: "file-tmp",
                name: "scratch.tmp",
                mimeType: "text/plain",
                modifiedTime: "2026-08-01T00:00:00.000Z",
                parents: ["root"],
              },
              {
                id: "file-kept",
                name: "keep.txt",
                mimeType: "text/plain",
                modifiedTime: "2026-08-01T00:00:00.000Z",
                parents: ["root"],
              },
            ],
          },
        });
      }
      return Promise.resolve({ data: { files: [] } });
    });
    const drive = { files: { list } } as unknown as drive_v3.Drive;

    const result = await listFilesRecursively(drive, "root", {
      namePatterns: ["^_", "\\.tmp$"],
    });

    expect(result).toHaveLength(2);
    expect(result.find((f) => f.id === "file-tmp")?.conversionKind).toBe(
      "excluded",
    );
    expect(result.find((f) => f.id === "file-kept")?.conversionKind).toBe(
      "copy",
    );
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("includes only files matching include.fileIds, marking others excluded", async () => {
    const list = vi.fn().mockResolvedValue({
      data: {
        files: [
          {
            id: "file-included",
            name: "keep.txt",
            mimeType: "text/plain",
            modifiedTime: "2026-08-01T00:00:00.000Z",
            parents: ["root"],
          },
          {
            id: "file-not-included",
            name: "other.txt",
            mimeType: "text/plain",
            modifiedTime: "2026-08-01T00:00:00.000Z",
            parents: ["root"],
          },
        ],
      },
    });
    const drive = { files: { list } } as unknown as drive_v3.Drive;

    const result = await listFilesRecursively(drive, "root", undefined, {
      fileIds: ["file-included"],
    });

    expect(result).toHaveLength(2);
    expect(result.find((f) => f.id === "file-included")?.conversionKind).toBe(
      "copy",
    );
    expect(
      result.find((f) => f.id === "file-not-included")?.conversionKind,
    ).toBe("excluded");
  });

  it("includes only files matching include.namePatterns", async () => {
    const list = vi.fn().mockResolvedValue({
      data: {
        files: [
          {
            id: "file-pdf",
            name: "report.pdf",
            mimeType: "application/pdf",
            modifiedTime: "2026-08-01T00:00:00.000Z",
            parents: ["root"],
          },
          {
            id: "file-txt",
            name: "notes.txt",
            mimeType: "text/plain",
            modifiedTime: "2026-08-01T00:00:00.000Z",
            parents: ["root"],
          },
        ],
      },
    });
    const drive = { files: { list } } as unknown as drive_v3.Drive;

    const result = await listFilesRecursively(drive, "root", undefined, {
      namePatterns: ["\\.pdf$"],
    });

    expect(result.find((f) => f.id === "file-pdf")?.conversionKind).toBe(
      "copy",
    );
    expect(result.find((f) => f.id === "file-txt")?.conversionKind).toBe(
      "excluded",
    );
  });

  it("does not let include prune folder traversal - files inside non-matching folders are still walked", async () => {
    const list = vi.fn().mockImplementation(({ q }: { q: string }) => {
      if (q.includes("'root'")) {
        return Promise.resolve({
          data: {
            files: [
              {
                id: "folder-sub",
                name: "sub",
                mimeType: "application/vnd.google-apps.folder",
                modifiedTime: "2026-08-01T00:00:00.000Z",
                parents: ["root"],
              },
            ],
          },
        });
      }
      return Promise.resolve({
        data: {
          files: [
            {
              id: "file-inside",
              name: "match.pdf",
              mimeType: "application/pdf",
              modifiedTime: "2026-08-01T00:00:00.000Z",
              parents: ["folder-sub"],
            },
          ],
        },
      });
    });
    const drive = { files: { list } } as unknown as drive_v3.Drive;

    const result = await listFilesRecursively(drive, "root", undefined, {
      namePatterns: ["\\.pdf$"],
    });

    expect(result.find((f) => f.id === "file-inside")?.conversionKind).toBe(
      "copy",
    );
  });

  it("checks include before exclude - a file matching both include and exclude is excluded", async () => {
    const list = vi.fn().mockResolvedValue({
      data: {
        files: [
          {
            id: "file-both",
            name: "both.pdf",
            mimeType: "application/pdf",
            modifiedTime: "2026-08-01T00:00:00.000Z",
            parents: ["root"],
          },
        ],
      },
    });
    const drive = { files: { list } } as unknown as drive_v3.Drive;

    const result = await listFilesRecursively(
      drive,
      "root",
      { fileIds: ["file-both"] },
      { namePatterns: ["\\.pdf$"] },
    );

    expect(result.find((f) => f.id === "file-both")?.conversionKind).toBe(
      "excluded",
    );
  });

  it("behaves exactly as before when include is omitted", async () => {
    const list = vi.fn().mockResolvedValue({
      data: {
        files: [
          {
            id: "file-1",
            name: "readme.txt",
            mimeType: "text/plain",
            modifiedTime: "2026-08-01T00:00:00.000Z",
            parents: ["root"],
          },
        ],
      },
    });
    const drive = { files: { list } } as unknown as drive_v3.Drive;

    const result = await listFilesRecursively(drive, "root");

    expect(result).toHaveLength(1);
    expect(result[0].conversionKind).toBe("copy");
  });

  it("behaves exactly as before when exclude is omitted", async () => {
    const list = vi.fn().mockResolvedValue({
      data: {
        files: [
          {
            id: "file-1",
            name: "readme.txt",
            mimeType: "text/plain",
            modifiedTime: "2026-08-01T00:00:00.000Z",
            parents: ["root"],
          },
        ],
      },
    });
    const drive = { files: { list } } as unknown as drive_v3.Drive;

    const result = await listFilesRecursively(drive, "root");

    expect(result).toHaveLength(1);
    expect(result[0].conversionKind).toBe("copy");
  });
});
