import type { sheets_v4 } from "googleapis";

export function rowsToCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsvField).join(",")).join("\r\n");
}

function escapeCsvField(field: string): string {
  if (/[",\r\n]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

export async function convertSpreadsheetToCsvFiles(
  sheetsClient: sheets_v4.Sheets,
  spreadsheetId: string,
): Promise<Map<string, string>> {
  const meta = await sheetsClient.spreadsheets.get({ spreadsheetId });
  const sheetTitles = (meta.data.sheets ?? [])
    .map((s) => s.properties?.title)
    .filter((t): t is string => !!t);

  const result = new Map<string, string>();
  for (const title of sheetTitles) {
    const quotedTitle = `'${title.replace(/'/g, "''")}'`;
    const valuesRes = await sheetsClient.spreadsheets.values.get({
      spreadsheetId,
      range: quotedTitle,
    });
    const rows = (valuesRes.data.values ?? []) as string[][];
    result.set(title, rowsToCsv(rows));
  }
  return result;
}
