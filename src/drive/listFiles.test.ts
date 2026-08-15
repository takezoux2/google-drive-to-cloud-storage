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

  it("renames a file whose base name matches an extension-less from rule, keeping the original extension", async () => {
    const list = vi.fn().mockResolvedValue({
      data: {
        files: [
          {
            id: "file-photo",
            name: "photo.jpg",
            mimeType: "image/jpeg",
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
      undefined,
      undefined,
      [{ from: "photo", to: "cover" }],
    );

    expect(result.find((f) => f.id === "file-photo")?.path).toBe("cover.jpg");
    expect(result.find((f) => f.id === "file-photo")?.name).toBe("cover.jpg");
  });

  it("does not rename a file when from has an extension that does not match", async () => {
    const list = vi.fn().mockResolvedValue({
      data: {
        files: [
          {
            id: "file-photo",
            name: "photo.png",
            mimeType: "image/png",
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
      undefined,
      undefined,
      [{ from: "photo.jpg", to: "cover.jpg" }],
    );

    expect(result.find((f) => f.id === "file-photo")?.path).toBe("photo.png");
  });

  it("renames a file when from has an extension that matches exactly", async () => {
    const list = vi.fn().mockResolvedValue({
      data: {
        files: [
          {
            id: "file-report",
            name: "old_report.pdf",
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
      undefined,
      undefined,
      [{ from: "old_report.pdf", to: "report_2024.pdf" }],
    );

    expect(result.find((f) => f.id === "file-report")?.path).toBe(
      "report_2024.pdf",
    );
  });

  it("uses to verbatim as the output name when to has an extension", async () => {
    const list = vi.fn().mockResolvedValue({
      data: {
        files: [
          {
            id: "file-photo",
            name: "photo.webp",
            mimeType: "image/webp",
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
      undefined,
      undefined,
      [{ from: "photo", to: "cover.jpg" }],
    );

    expect(result.find((f) => f.id === "file-photo")?.path).toBe("cover.jpg");
  });

  it("keeps a file without an extension unrenamed-in-extension when to has no extension (e.g. Google Docs)", async () => {
    const list = vi.fn().mockResolvedValue({
      data: {
        files: [
          {
            id: "file-doc",
            name: "Meeting Notes",
            mimeType: "application/vnd.google-apps.document",
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
      undefined,
      undefined,
      [{ from: "Meeting Notes", to: "Notes" }],
    );

    expect(result.find((f) => f.id === "file-doc")?.path).toBe("Notes");
  });

  it("applies only the first matching rename rule when multiple rules could match", async () => {
    const list = vi.fn().mockResolvedValue({
      data: {
        files: [
          {
            id: "file-photo",
            name: "photo.jpg",
            mimeType: "image/jpeg",
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
      undefined,
      undefined,
      [
        { from: "photo", to: "first-match" },
        { from: "photo", to: "second-match" },
      ],
    );

    expect(result.find((f) => f.id === "file-photo")?.path).toBe(
      "first-match.jpg",
    );
  });

  it("does not rename folders even when a folder name matches a rename rule", async () => {
    const list = vi.fn().mockImplementation(({ q }: { q: string }) => {
      if (q.includes("'root'")) {
        return Promise.resolve({
          data: {
            files: [
              {
                id: "folder-photo",
                name: "photo",
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
              name: "inside.txt",
              mimeType: "text/plain",
              modifiedTime: "2026-08-01T00:00:00.000Z",
              parents: ["folder-photo"],
            },
          ],
        },
      });
    });
    const drive = { files: { list } } as unknown as drive_v3.Drive;

    const result = await listFilesRecursively(
      drive,
      "root",
      undefined,
      undefined,
      [{ from: "photo", to: "cover" }],
    );

    expect(result.find((f) => f.id === "file-inside")?.path).toBe(
      "photo/inside.txt",
    );
  });

  it("evaluates exclude/include against the original file name, not the renamed name", async () => {
    const list = vi.fn().mockResolvedValue({
      data: {
        files: [
          {
            id: "file-photo",
            name: "photo.jpg",
            mimeType: "image/jpeg",
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
      { namePatterns: ["^photo"] },
      undefined,
      [{ from: "photo", to: "cover" }],
    );

    expect(result.find((f) => f.id === "file-photo")?.conversionKind).toBe(
      "excluded",
    );
    expect(result.find((f) => f.id === "file-photo")?.path).toBe("cover.jpg");
  });

  it("treats a name with no path.extname() extension (e.g. .gitignore) as extension-less for matching", async () => {
    const list = vi.fn().mockResolvedValue({
      data: {
        files: [
          {
            id: "file-dotfile",
            name: ".gitignore",
            mimeType: "text/plain",
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
      undefined,
      undefined,
      [{ from: ".gitignore", to: "ignore-rules" }],
    );

    expect(result.find((f) => f.id === "file-dotfile")?.path).toBe(
      "ignore-rules",
    );
  });

  it("behaves exactly as before when rename is omitted", async () => {
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

    expect(result[0].path).toBe("readme.txt");
  });

  it("records the matched rule's index in matchedRenameIndices", async () => {
    const list = vi.fn().mockResolvedValue({
      data: {
        files: [
          {
            id: "file-photo",
            name: "photo.jpg",
            mimeType: "image/jpeg",
            modifiedTime: "2026-08-01T00:00:00.000Z",
            parents: ["root"],
          },
        ],
      },
    });
    const drive = { files: { list } } as unknown as drive_v3.Drive;
    const matchedRenameIndices = new Set<number>();

    await listFilesRecursively(
      drive,
      "root",
      undefined,
      undefined,
      [
        { from: "old_report.pdf", to: "report_2024.pdf" },
        { from: "photo", to: "cover" },
      ],
      matchedRenameIndices,
    );

    expect(matchedRenameIndices).toEqual(new Set([1]));
  });

  it("does not record an index for a rule that never matches any file", async () => {
    const list = vi.fn().mockResolvedValue({
      data: {
        files: [
          {
            id: "file-photo",
            name: "photo.jpg",
            mimeType: "image/jpeg",
            modifiedTime: "2026-08-01T00:00:00.000Z",
            parents: ["root"],
          },
        ],
      },
    });
    const drive = { files: { list } } as unknown as drive_v3.Drive;
    const matchedRenameIndices = new Set<number>();

    await listFilesRecursively(
      drive,
      "root",
      undefined,
      undefined,
      [
        { from: "photo", to: "cover" },
        { from: "unused_rule.pdf", to: "x.pdf" },
      ],
      matchedRenameIndices,
    );

    expect(matchedRenameIndices).toEqual(new Set([0]));
    expect(matchedRenameIndices.has(1)).toBe(false);
  });

  it("records indices for multiple matching rules across multiple files", async () => {
    const list = vi.fn().mockResolvedValue({
      data: {
        files: [
          {
            id: "file-photo",
            name: "photo.jpg",
            mimeType: "image/jpeg",
            modifiedTime: "2026-08-01T00:00:00.000Z",
            parents: ["root"],
          },
          {
            id: "file-report",
            name: "old_report.pdf",
            mimeType: "application/pdf",
            modifiedTime: "2026-08-01T00:00:00.000Z",
            parents: ["root"],
          },
        ],
      },
    });
    const drive = { files: { list } } as unknown as drive_v3.Drive;
    const matchedRenameIndices = new Set<number>();

    await listFilesRecursively(
      drive,
      "root",
      undefined,
      undefined,
      [
        { from: "photo", to: "cover" },
        { from: "old_report.pdf", to: "report_2024.pdf" },
      ],
      matchedRenameIndices,
    );

    expect(matchedRenameIndices).toEqual(new Set([0, 1]));
  });

  it("works without matchedRenameIndices provided (optional, no crash)", async () => {
    const list = vi.fn().mockResolvedValue({
      data: {
        files: [
          {
            id: "file-photo",
            name: "photo.jpg",
            mimeType: "image/jpeg",
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
      undefined,
      undefined,
      [{ from: "photo", to: "cover" }],
    );

    expect(result[0].path).toBe("cover.jpg");
  });
});
