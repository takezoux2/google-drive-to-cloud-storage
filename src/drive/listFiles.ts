import { extname } from "node:path";
import type { drive_v3 } from "googleapis";
import type {
  ExcludeConfig,
  IncludeConfig,
  RenameRule,
} from "../config/schema.js";
import type { ClassifiedFile } from "../types.js";
import { classifyMimeType } from "./convert/classify.js";

const FOLDER_MIME = "application/vnd.google-apps.folder";

interface CompiledExclude {
  fileIds: Set<string>;
  namePatterns: RegExp[];
}

interface CompiledInclude {
  active: boolean;
  fileIds: Set<string>;
  namePatterns: RegExp[];
}

interface CompiledRenameRule {
  from: string;
  fromExt: string;
  to: string;
  toExt: string;
}

function compileExclude(exclude?: ExcludeConfig): CompiledExclude {
  return {
    fileIds: new Set(exclude?.fileIds ?? []),
    namePatterns: (exclude?.namePatterns ?? []).map((p) => new RegExp(p)),
  };
}

function compileInclude(include?: IncludeConfig): CompiledInclude {
  const fileIds = include?.fileIds ?? [];
  const namePatterns = include?.namePatterns ?? [];
  return {
    active: fileIds.length > 0 || namePatterns.length > 0,
    fileIds: new Set(fileIds),
    namePatterns: namePatterns.map((p) => new RegExp(p)),
  };
}

function compileRename(rules?: RenameRule[]): CompiledRenameRule[] {
  return (rules ?? []).map((rule) => ({
    from: rule.from,
    fromExt: extname(rule.from),
    to: rule.to,
    toExt: extname(rule.to),
  }));
}

function isExcluded(
  compiled: CompiledExclude,
  id: string,
  name: string,
): boolean {
  if (compiled.fileIds.has(id)) return true;
  return compiled.namePatterns.some((re) => re.test(name));
}

function isIncluded(compiled: CompiledInclude, id: string, name: string): boolean {
  if (!compiled.active) return true;
  if (compiled.fileIds.has(id)) return true;
  return compiled.namePatterns.some((re) => re.test(name));
}

function splitExt(name: string): { base: string; ext: string } {
  const ext = extname(name);
  return ext ? { base: name.slice(0, -ext.length), ext } : { base: name, ext: "" };
}

function applyRename(rules: CompiledRenameRule[], name: string): string {
  const { base, ext } = splitExt(name);
  for (const rule of rules) {
    const matched = rule.fromExt ? name === rule.from : base === rule.from;
    if (matched) {
      return rule.toExt ? rule.to : `${rule.to}${ext}`;
    }
  }
  return name;
}

export async function listFilesRecursively(
  drive: drive_v3.Drive,
  rootFolderId: string,
  exclude?: ExcludeConfig,
  include?: IncludeConfig,
  rename?: RenameRule[],
): Promise<ClassifiedFile[]> {
  const result: ClassifiedFile[] = [];
  const compiledExclude = compileExclude(exclude);
  const compiledInclude = compileInclude(include);
  const compiledRename = compileRename(rename);
  await walk(
    drive,
    rootFolderId,
    "",
    result,
    compiledExclude,
    compiledInclude,
    compiledRename,
  );
  return result;
}

async function walk(
  drive: drive_v3.Drive,
  folderId: string,
  pathPrefix: string,
  result: ClassifiedFile[],
  exclude: CompiledExclude,
  include: CompiledInclude,
  rename: CompiledRenameRule[],
): Promise<void> {
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, modifiedTime, parents)",
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const files = res.data.files ?? [];
    for (const file of files) {
      if (!file.id || !file.name || !file.mimeType || !file.modifiedTime)
        continue;
      if (file.mimeType === FOLDER_MIME) {
        const path = pathPrefix ? `${pathPrefix}/${file.name}` : file.name;
        if (isExcluded(exclude, file.id, file.name)) continue;
        await walk(drive, file.id, path, result, exclude, include, rename);
      } else {
        const outputName = applyRename(rename, file.name);
        const path = pathPrefix ? `${pathPrefix}/${outputName}` : outputName;
        const notIncluded = !isIncluded(include, file.id, file.name);
        const excluded = notIncluded || isExcluded(exclude, file.id, file.name);
        result.push({
          id: file.id,
          name: outputName,
          mimeType: file.mimeType,
          modifiedTime: file.modifiedTime,
          path,
          parents: file.parents ?? [],
          conversionKind: excluded
            ? "excluded"
            : classifyMimeType(file.mimeType),
        });
      }
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
}
