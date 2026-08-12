import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "./loadConfig.js";

describe("loadConfig", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "gdrive-sync-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("parses a valid config file", async () => {
    const configPath = path.join(dir, "config.yaml");
    await writeFile(
      configPath,
      `
mappings:
  - driveFolderId: "abc123"
    destination:
      provider: gcs
      bucket: "my-bucket"
      prefix: "backups"
concurrency: 4
`,
      "utf-8",
    );

    const config = await loadConfig(configPath);

    expect(config.mappings).toHaveLength(1);
    expect(config.mappings[0].driveFolderId).toBe("abc123");
    expect(config.mappings[0].destination.provider).toBe("gcs");
    expect(config.concurrency).toBe(4);
  });

  it("throws when mappings is missing", async () => {
    const configPath = path.join(dir, "invalid.yaml");
    await writeFile(configPath, "concurrency: 2\n", "utf-8");

    await expect(loadConfig(configPath)).rejects.toThrow();
  });
});
