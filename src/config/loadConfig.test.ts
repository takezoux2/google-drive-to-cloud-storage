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
`,
      "utf-8",
    );

    const config = await loadConfig(configPath);

    expect(config.mappings).toHaveLength(1);
    expect(config.mappings[0].driveFolderId).toBe("abc123");
    expect(config.mappings[0].destination.provider).toBe("gcs");
  });

  it("throws when mappings is missing", async () => {
    const configPath = path.join(dir, "invalid.yaml");
    await writeFile(configPath, "foo: bar\n", "utf-8");

    await expect(loadConfig(configPath)).rejects.toThrow();
  });

  it("parses a valid local provider config", async () => {
    const configPath = path.join(dir, "local.yaml");
    await writeFile(
      configPath,
      `
mappings:
  - driveFolderId: "abc123"
    destination:
      provider: local
      path: "./backups/team-c"
      prefix: "docs"
`,
      "utf-8",
    );

    const config = await loadConfig(configPath);

    expect(config.mappings[0].destination.provider).toBe("local");
    expect(config.mappings[0].destination.path).toBe("./backups/team-c");
  });

  it("throws when provider is local and path is missing", async () => {
    const configPath = path.join(dir, "local-missing-path.yaml");
    await writeFile(
      configPath,
      `
mappings:
  - driveFolderId: "abc123"
    destination:
      provider: local
`,
      "utf-8",
    );

    await expect(loadConfig(configPath)).rejects.toThrow();
  });

  it("throws when provider is gcs and bucket is missing", async () => {
    const configPath = path.join(dir, "gcs-missing-bucket.yaml");
    await writeFile(
      configPath,
      `
mappings:
  - driveFolderId: "abc123"
    destination:
      provider: gcs
`,
      "utf-8",
    );

    await expect(loadConfig(configPath)).rejects.toThrow();
  });
});
