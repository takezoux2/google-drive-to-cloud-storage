import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { type AppConfig, configSchema } from "./schema.js";

export async function loadConfig(filePath: string): Promise<AppConfig> {
  const raw = await readFile(filePath, "utf-8");
  const data = parse(raw);
  return configSchema.parse(data);
}
