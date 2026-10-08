import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONFIG_ENV_VAR, loadConfig, resolveConfig } from "./loadConfig.js";

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

  it("parses a mapping with exclude fileIds and namePatterns", async () => {
    const configPath = path.join(dir, "exclude.yaml");
    await writeFile(
      configPath,
      `
mappings:
  - driveFolderId: "abc123"
    destination:
      provider: gcs
      bucket: "my-bucket"
    exclude:
      fileIds:
        - "excluded-id-1"
      namePatterns:
        - "^_.*"
        - "\\\\.tmp$"
`,
      "utf-8",
    );

    const config = await loadConfig(configPath);

    expect(config.mappings[0].exclude?.fileIds).toEqual(["excluded-id-1"]);
    expect(config.mappings[0].exclude?.namePatterns).toEqual([
      "^_.*",
      "\\.tmp$",
    ]);
  });

  it("parses a mapping with no exclude block (backward compatible)", async () => {
    const configPath = path.join(dir, "no-exclude.yaml");
    await writeFile(
      configPath,
      `
mappings:
  - driveFolderId: "abc123"
    destination:
      provider: gcs
      bucket: "my-bucket"
`,
      "utf-8",
    );

    const config = await loadConfig(configPath);

    expect(config.mappings[0].exclude).toBeUndefined();
  });

  it("throws when a namePattern is not a valid regular expression", async () => {
    const configPath = path.join(dir, "bad-regex.yaml");
    await writeFile(
      configPath,
      `
mappings:
  - driveFolderId: "abc123"
    destination:
      provider: gcs
      bucket: "my-bucket"
    exclude:
      namePatterns:
        - "["
`,
      "utf-8",
    );

    await expect(loadConfig(configPath)).rejects.toThrow();
  });

  it("parses a mapping with include fileIds and namePatterns", async () => {
    const configPath = path.join(dir, "include.yaml");
    await writeFile(
      configPath,
      `
mappings:
  - driveFolderId: "abc123"
    destination:
      provider: gcs
      bucket: "my-bucket"
    include:
      fileIds:
        - "included-id-1"
      namePatterns:
        - "\\\\.pdf$"
`,
      "utf-8",
    );

    const config = await loadConfig(configPath);

    expect(config.mappings[0].include?.fileIds).toEqual(["included-id-1"]);
    expect(config.mappings[0].include?.namePatterns).toEqual(["\\.pdf$"]);
  });

  it("parses a mapping with no include block (backward compatible)", async () => {
    const configPath = path.join(dir, "no-include.yaml");
    await writeFile(
      configPath,
      `
mappings:
  - driveFolderId: "abc123"
    destination:
      provider: gcs
      bucket: "my-bucket"
`,
      "utf-8",
    );

    const config = await loadConfig(configPath);

    expect(config.mappings[0].include).toBeUndefined();
  });

  it("throws when an include namePattern is not a valid regular expression", async () => {
    const configPath = path.join(dir, "include-bad-regex.yaml");
    await writeFile(
      configPath,
      `
mappings:
  - driveFolderId: "abc123"
    destination:
      provider: gcs
      bucket: "my-bucket"
    include:
      namePatterns:
        - "["
`,
      "utf-8",
    );

    await expect(loadConfig(configPath)).rejects.toThrow();
  });

  it("parses config-level rename rules", async () => {
    const configPath = path.join(dir, "rename.yaml");
    await writeFile(
      configPath,
      `
rename:
  - from: "photo"
    to: "cover"
  - from: "old_report.pdf"
    to: "report_2024.pdf"
mappings:
  - driveFolderId: "abc123"
    destination:
      provider: gcs
      bucket: "my-bucket"
`,
      "utf-8",
    );

    const config = await loadConfig(configPath);

    expect(config.rename).toEqual([
      { from: "photo", to: "cover" },
      { from: "old_report.pdf", to: "report_2024.pdf" },
    ]);
  });

  it("parses a config with no rename block (backward compatible)", async () => {
    const configPath = path.join(dir, "no-rename.yaml");
    await writeFile(
      configPath,
      `
mappings:
  - driveFolderId: "abc123"
    destination:
      provider: gcs
      bucket: "my-bucket"
`,
      "utf-8",
    );

    const config = await loadConfig(configPath);

    expect(config.rename).toBeUndefined();
  });

  it("throws when a rename rule has an empty from", async () => {
    const configPath = path.join(dir, "rename-empty-from.yaml");
    await writeFile(
      configPath,
      `
rename:
  - from: ""
    to: "cover"
mappings:
  - driveFolderId: "abc123"
    destination:
      provider: gcs
      bucket: "my-bucket"
`,
      "utf-8",
    );

    await expect(loadConfig(configPath)).rejects.toThrow();
  });

  it("throws when a rename rule has an empty to", async () => {
    const configPath = path.join(dir, "rename-empty-to.yaml");
    await writeFile(
      configPath,
      `
rename:
  - from: "photo"
    to: ""
mappings:
  - driveFolderId: "abc123"
    destination:
      provider: gcs
      bucket: "my-bucket"
`,
      "utf-8",
    );

    await expect(loadConfig(configPath)).rejects.toThrow();
  });
});

describe("resolveConfig", () => {
  const validYaml = `
mappings:
  - driveFolderId: "env-folder"
    destination:
      provider: gcs
      bucket: "env-bucket"
`;

  it("loads from the config file when a path is given", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gdrive-sync-"));
    const configPath = path.join(dir, "config.yaml");
    await writeFile(
      configPath,
      `
mappings:
  - driveFolderId: "file-folder"
    destination:
      provider: gcs
      bucket: "file-bucket"
`,
      "utf-8",
    );

    const config = await resolveConfig({
      configPath,
      env: { [CONFIG_ENV_VAR]: validYaml },
    });

    expect(config.mappings[0].driveFolderId).toBe("file-folder");
    await rm(dir, { recursive: true, force: true });
  });

  it("parses raw YAML from the environment variable when no path is given", async () => {
    const config = await resolveConfig({
      env: { [CONFIG_ENV_VAR]: validYaml },
    });

    expect(config.mappings[0].driveFolderId).toBe("env-folder");
    expect(config.mappings[0].destination.bucket).toBe("env-bucket");
  });

  it("parses raw JSON from the environment variable", async () => {
    const config = await resolveConfig({
      env: {
        [CONFIG_ENV_VAR]: JSON.stringify({
          mappings: [
            {
              driveFolderId: "json-folder",
              destination: { provider: "local", path: "./out" },
            },
          ],
        }),
      },
    });

    expect(config.mappings[0].driveFolderId).toBe("json-folder");
    expect(config.mappings[0].destination.path).toBe("./out");
  });

  it("throws when the environment variable holds an invalid config", async () => {
    await expect(
      resolveConfig({ env: { [CONFIG_ENV_VAR]: "foo: bar\n" } }),
    ).rejects.toThrow();
  });

  it("throws when neither a path nor the environment variable is given", async () => {
    await expect(resolveConfig({ env: {} })).rejects.toThrow(CONFIG_ENV_VAR);
  });

  it("ignores a blank environment variable", async () => {
    await expect(
      resolveConfig({ env: { [CONFIG_ENV_VAR]: "   " } }),
    ).rejects.toThrow(CONFIG_ENV_VAR);
  });
});
