#!/usr/bin/env node
import { Command } from "commander";
import { createStorageProvider } from "./cli/createStorageProvider.js";
import { CONFIG_ENV_VAR, resolveConfig } from "./config/loadConfig.js";
import { createGoogleClients } from "./drive/client.js";
import { syncMapping } from "./sync/syncRunner.js";

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("sync-gdrive")
    .option(
      "-c, --config <path>",
      `path to config YAML file (falls back to the raw config in the ${CONFIG_ENV_VAR} environment variable)`,
    )
    .option("--dry-run", "list changes without uploading or deleting", false);
  program.parse(process.argv);
  const options = program.opts<{ config?: string; dryRun: boolean }>();

  const config = await resolveConfig({ configPath: options.config });
  const { drive, docs, sheets, authenticatedEmail } =
    await createGoogleClients();
  console.log(`Authenticated as: ${authenticatedEmail ?? "unavailable"}`);

  let hasFailure = false;
  const matchedRenameIndices = new Set<number>();
  for (const mapping of config.mappings) {
    const storage = createStorageProvider(mapping.destination);
    const result = await syncMapping(
      mapping.driveFolderId,
      {
        drive,
        docs,
        sheets,
        storage,
        dryRun: options.dryRun,
      },
      mapping.exclude,
      mapping.include,
      config.rename,
      matchedRenameIndices,
    );

    console.log(
      `[${mapping.driveFolderId}] uploaded=${result.uploaded.length} deleted=${result.deleted.length} excluded=${result.excluded.length} failed=${result.failed.length}`,
    );
    for (const failure of result.failed) {
      console.error(`  FAILED ${failure.sourcePath}: ${failure.error}`);
      hasFailure = true;
    }
  }

  for (const [i, rule] of (config.rename ?? []).entries()) {
    if (!matchedRenameIndices.has(i)) {
      console.log(
        `Rename rule not matched: from="${rule.from}" to="${rule.to}"`,
      );
    }
  }

  if (hasFailure) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(
    err instanceof Error ? (err.stack ?? err.message) : String(err),
  );
  process.exitCode = 1;
});
