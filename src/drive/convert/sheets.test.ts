import type { sheets_v4 } from "googleapis";
import { describe, expect, it, vi } from "vitest";
import { convertSpreadsheetToCsvFiles, rowsToCsv } from "./sheets.js";

describe("rowsToCsv", () => {
  it("joins simple rows with commas and CRLF", () => {
    expect(
      rowsToCsv([
        ["a", "b"],
        ["c", "d"],
      ]),
    ).toBe("a,b\r\nc,d");
  });

  it("quotes fields containing commas, quotes, or newlines", () => {
    expect(rowsToCsv([["a,b", 'say "hi"', "line1\nline2"]])).toBe(
      '"a,b","say ""hi""","line1\nline2"',
    );
  });
});

describe("convertSpreadsheetToCsvFiles", () => {
  it("fetches every sheet and converts its values to CSV", async () => {
    const sheetsClient = {
      spreadsheets: {
        get: vi.fn().mockResolvedValue({
          data: {
            sheets: [
              { properties: { title: "Sheet1" } },
              { properties: { title: "Sheet 2" } },
            ],
          },
        }),
        values: {
          get: vi.fn().mockImplementation(({ range }: { range: string }) => {
            if (range === "'Sheet1'") {
              return Promise.resolve({ data: { values: [["a", "b"]] } });
            }
            return Promise.resolve({ data: { values: [["c", "d"]] } });
          }),
        },
      },
    } as unknown as sheets_v4.Sheets;

    const result = await convertSpreadsheetToCsvFiles(sheetsClient, "sheet-id");

    expect(result.get("Sheet1")).toBe("a,b");
    expect(result.get("Sheet 2")).toBe("c,d");
    expect(sheetsClient.spreadsheets.values.get).toHaveBeenCalledWith(
      expect.objectContaining({
        spreadsheetId: "sheet-id",
        range: "'Sheet 2'",
      }),
    );
  });
});
