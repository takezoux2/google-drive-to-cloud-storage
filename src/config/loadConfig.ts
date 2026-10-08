import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { type AppConfig, configSchema } from "./schema.js";

/** Name of the environment variable that can hold the raw config (YAML or JSON). */
export const CONFIG_ENV_VAR = "SYNC_GDRIVE_CONFIG";

export function parseConfig(raw: string): AppConfig {
  return configSchema.parse(parse(raw));
}

export async function loadConfig(filePath: string): Promise<AppConfig> {
  const raw = await readFile(filePath, "utf-8");
  return parseConfig(raw);
}

/**
 * Resolves the config from an explicit file path, falling back to the raw
 * config text held in the `SYNC_GDRIVE_CONFIG` environment variable.
 */
export async function resolveConfig(options: {
  configPath?: string;
  env?: Record<string, string | undefined>;
}): Promise<AppConfig> {
  if (options.configPath) {
    return loadConfig(options.configPath);
  }

  const raw = (options.env ?? process.env)[CONFIG_ENV_VAR];
  if (raw && raw.trim() !== "") {
    return parseConfig(raw);
  }

  throw new Error(
    `config is not specified: pass -c/--config <path>, or set the ${CONFIG_ENV_VAR} environment variable to the raw config (YAML or JSON)`,
  );
}
