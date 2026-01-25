#!/usr/bin/env node
/**
 * Traffical CLI
 *
 * Config-as-code for your experimentation platform.
 *
 * Commands:
 *   init               - Initialize Traffical in a project
 *   pull               - Pull synced params from Traffical → local file
 *   push               - Push local file params → Traffical
 *   sync               - Bidirectional sync (pull + push)
 *   status             - Show sync status
 *   import             - Add dashboard param to config file
 *   integrate-ai-tools - Add Traffical references to AI tool config files
 *
 * Exit Codes:
 *   0  - Success
 *   1  - Validation error (invalid config)
 *   2  - Authentication error (bad API key)
 *   3  - Network/API error
 *   10 - Config drift detected (status command)
 *   11 - Experiment needs attention
 */

import { Command } from "commander";
import chalk from "chalk";
import { initCommand } from "./commands/init.ts";
import { pullCommand } from "./commands/pull.ts";
import { pushCommand } from "./commands/push.ts";
import { syncCommand } from "./commands/sync.ts";
import { statusCommand } from "./commands/status.ts";
import { importCommand } from "./commands/import.ts";
import { integrateAIToolsCommand } from "./commands/integrate-ai-tools.ts";
import { generateTypesCommand } from "./commands/generate-types.ts";
import { CliError, EXIT_VALIDATION_ERROR } from "./lib/api.ts";
import { TRAFFICAL_DIR, CONFIG_FILENAME } from "./lib/config.ts";

/**
 * Handle errors with appropriate exit codes.
 */
function handleError(error: unknown, format?: string): never {
  const isJson = format === "json";

  if (error instanceof CliError) {
    if (isJson) {
      console.log(JSON.stringify({ success: false, error: error.message }));
    } else {
      console.error(chalk.red(`Error: ${error.message}`));
    }
    process.exit(error.exitCode);
  }

  // Unknown errors default to validation error (exit 1)
  const message = error instanceof Error ? error.message : String(error);
  if (isJson) {
    console.log(JSON.stringify({ success: false, error: message }));
  } else {
    console.error(chalk.red(`Error: ${message}`));
  }
  process.exit(EXIT_VALIDATION_ERROR);
}

const program = new Command();

program
  .name("traffical")
  .description("Config-as-code for your experimentation platform")
  .version("0.1.0");

// Global options
program
  .option("-p, --profile <name>", "Profile to use from ~/.trafficalrc")
  .option("-c, --config <path>", `Path to config file (default: ${TRAFFICAL_DIR}/${CONFIG_FILENAME})`)
  .option("-b, --api-base <url>", "API base URL (overrides profile setting)")
  .option("-j, --format <format>", "Output format: human (default) or json", "human");

// Init command
program
  .command("init")
  .description("Initialize Traffical in a project (creates .traffical/ directory)")
  .option("--api-key <key>", "API key for authentication")
  .action(async (options) => {
    const globalOpts = program.opts();
    try {
      await initCommand({
        profile: globalOpts.profile,
        apiKey: options.apiKey,
        apiBase: globalOpts.apiBase,
        format: globalOpts.format,
      });
    } catch (error) {
      handleError(error, globalOpts.format);
    }
  });

// Pull command
program
  .command("pull")
  .description("Pull synced parameters from Traffical to local config")
  .action(async () => {
    const globalOpts = program.opts();
    try {
      await pullCommand({
        profile: globalOpts.profile,
        configPath: globalOpts.config,
        apiBase: globalOpts.apiBase,
        format: globalOpts.format,
      });
    } catch (error) {
      handleError(error, globalOpts.format);
    }
  });

// Push command
program
  .command("push")
  .description("Push local config parameters to Traffical")
  .option("-n, --dry-run", "Validate and show changes without pushing")
  .action(async (options) => {
    const globalOpts = program.opts();
    try {
      await pushCommand({
        profile: globalOpts.profile,
        configPath: globalOpts.config,
        apiBase: globalOpts.apiBase,
        dryRun: options.dryRun,
        format: globalOpts.format,
      });
    } catch (error) {
      handleError(error, globalOpts.format);
    }
  });

// Sync command
program
  .command("sync")
  .description("Sync config with Traffical (local wins: pushes your changes, adds new remote params)")
  .option("--all", "Sync all config files in the repository")
  .option("-n, --dry-run", "Validate and show changes without syncing")
  .action(async (options) => {
    const globalOpts = program.opts();
    try {
      await syncCommand({
        profile: globalOpts.profile,
        configPath: globalOpts.config,
        apiBase: globalOpts.apiBase,
        all: options.all,
        dryRun: options.dryRun,
        format: globalOpts.format,
      });
    } catch (error) {
      handleError(error, globalOpts.format);
    }
  });

// Status command
program
  .command("status")
  .description("Show current sync status")
  .action(async () => {
    const globalOpts = program.opts();
    try {
      await statusCommand({
        profile: globalOpts.profile,
        configPath: globalOpts.config,
        apiBase: globalOpts.apiBase,
        format: globalOpts.format,
      });
    } catch (error) {
      handleError(error, globalOpts.format);
    }
  });

// Import command
program
  .command("import <key>")
  .description("Import dashboard parameters to config (supports wildcards: ui.*, *.enabled)")
  .action(async (key: string) => {
    const globalOpts = program.opts();
    try {
      await importCommand({
        profile: globalOpts.profile,
        configPath: globalOpts.config,
        apiBase: globalOpts.apiBase,
        key,
        format: globalOpts.format,
      });
    } catch (error) {
      handleError(error, globalOpts.format);
    }
  });

// Integrate AI Tools command
program
  .command("integrate-ai-tools")
  .description("Add Traffical references to AI coding tool config files (CLAUDE.md, .cursorrules, etc.)")
  .option("-y, --yes", "Automatically confirm without prompting")
  .action(async (options) => {
    const globalOpts = program.opts();
    try {
      await integrateAIToolsCommand({
        format: globalOpts.format,
        yes: options.yes,
      });
    } catch (error) {
      handleError(error, globalOpts.format);
    }
  });

// Generate Types command
program
  .command("generate-types")
  .description("Generate TypeScript types from traffical.yaml config")
  .option("-o, --output <path>", "Output file path (default: .traffical/traffical.generated.ts)")
  .action(async (options) => {
    const globalOpts = program.opts();
    try {
      await generateTypesCommand({
        configPath: globalOpts.config,
        output: options.output,
        format: globalOpts.format,
      });
    } catch (error) {
      handleError(error, globalOpts.format);
    }
  });

program.parse();
