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
});
