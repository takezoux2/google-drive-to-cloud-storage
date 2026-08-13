#!/usr/bin/env node
import { Command } from "commander";
import { createStorageProvider } from "./cli/createStorageProvider.js";
import { loadConfig } from "./config/loadConfig.js";
import { createGoogleClients } from "./drive/client.js";
import { syncMapping } from "./sync/syncRunner.js";

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("gdrive-to-cloud-storage")
    .requiredOption("-c, --config <path>", "path to config YAML file")
    .option("--dry-run", "list changes without uploading or deleting", false);
  program.parse(process.argv);
  const options = program.opts<{ config: string; dryRun: boolean }>();

  const config = await loadConfig(options.config);
  const { drive, docs, sheets, authenticatedEmail } =
    await createGoogleClients();
  console.log(`Authenticated as: ${authenticatedEmail ?? "unavailable"}`);

  let hasFailure = false;
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
    );

    console.log(
      `[${mapping.driveFolderId}] uploaded=${result.uploaded.length} deleted=${result.deleted.length} excluded=${result.excluded.length} failed=${result.failed.length}`,
    );
    for (const failure of result.failed) {
      console.error(`  FAILED ${failure.sourcePath}: ${failure.error}`);
      hasFailure = true;
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
