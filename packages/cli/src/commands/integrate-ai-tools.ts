/**
 * integrate-ai-tools command
 *
 * Detect and update AI coding tool configuration files
 * (CLAUDE.md, .cursorrules, etc.) with Traffical references.
 */

import chalk from "chalk";
import { confirm } from "@inquirer/prompts";
import {
  detectAIToolFiles,
  addTrafficalReference,
  getUpdatableTools,
  getAlreadyIntegratedTools,
  hasAnyAIToolFiles,
  type DetectedAITool,
} from "../lib/ai-tools.ts";
import { parseFormatOption } from "../lib/output.ts";

export interface IntegrateAIToolsOptions {
  format?: string | boolean;
  yes?: boolean;
}

export interface IntegrateAIToolsResult {
  success: boolean;
  detected: Array<{
    filename: string;
    tool: string;
    exists: boolean;
    hasTrafficalReference: boolean;
  }>;
  updated: string[];
  skipped: string[];
  alreadyIntegrated: string[];
}

/**
 * Core function to integrate AI tools (can be used by MCP or other integrations).
 */
export async function integrateAITools(options: {
  projectDir?: string;
  autoConfirm?: boolean;
}): Promise<IntegrateAIToolsResult> {
  const projectDir = options.projectDir || process.cwd();
  const aiTools = await detectAIToolFiles(projectDir);

  const detected = aiTools.map((t) => ({
    filename: t.file.filename,
    tool: t.file.tool,
    exists: t.exists,
    hasTrafficalReference: t.hasTrafficalReference,
  }));

  const updatable = getUpdatableTools(aiTools);
  const alreadyIntegrated = getAlreadyIntegratedTools(aiTools);

  const updated: string[] = [];
  const skipped: string[] = [];

  // If autoConfirm is true, update all updatable tools
  if (options.autoConfirm) {
    for (const tool of updatable) {
      await addTrafficalReference(tool);
      updated.push(tool.file.filename);
    }
  }

  return {
    success: true,
    detected,
    updated,
    skipped: updatable.filter((t) => !updated.includes(t.file.filename)).map((t) => t.file.filename),
    alreadyIntegrated: alreadyIntegrated.map((t) => t.file.filename),
  };
}

/**
 * Print result for human-readable output.
 */
function printIntegrateHuman(result: IntegrateAIToolsResult): void {
  const existingFiles = result.detected.filter((d) => d.exists);

  if (existingFiles.length === 0) {
    console.log(chalk.yellow("No AI coding tool configuration files found.\n"));
    console.log("Supported files:");
    console.log(chalk.dim("  • CLAUDE.md (Claude Code)"));
    console.log(chalk.dim("  • .cursorrules (Cursor)"));
    console.log(chalk.dim("  • .github/copilot-instructions.md (GitHub Copilot)"));
    console.log(chalk.dim("  • .windsurfrules (Windsurf)"));
    console.log();
    return;
  }

  if (result.alreadyIntegrated.length > 0) {
    console.log(chalk.green(`Already integrated (${result.alreadyIntegrated.length}):`));
    result.alreadyIntegrated.forEach((f) => {
      console.log(chalk.dim(`  ✓ ${f}`));
    });
    console.log();
  }

  if (result.updated.length > 0) {
    console.log(chalk.green(`Updated (${result.updated.length}):`));
    result.updated.forEach((f) => {
      console.log(chalk.green(`  ✓ ${f}`));
    });
    console.log();
  }

  if (result.skipped.length > 0) {
    console.log(chalk.yellow(`Skipped (${result.skipped.length}):`));
    result.skipped.forEach((f) => {
      console.log(chalk.dim(`  - ${f}`));
    });
    console.log();
  }

  if (result.updated.length > 0) {
    console.log(chalk.dim("Added Traffical reference section to the above files."));
    console.log(chalk.dim("AI agents will now be aware of Traffical configuration."));
  }
}

export async function integrateAIToolsCommand(options: IntegrateAIToolsOptions): Promise<void> {
  const format = parseFormatOption(options.format);
  const isJson = format === "json";

  if (!isJson) {
    console.log(chalk.bold("AI Tool Integration\n"));
    console.log("Scanning for AI coding tool configuration files...\n");
  }

  const projectDir = process.cwd();
  const aiTools = await detectAIToolFiles(projectDir);

  const updatable = getUpdatableTools(aiTools);
  const alreadyIntegrated = getAlreadyIntegratedTools(aiTools);

  // For JSON output or --yes flag, just process and output
  if (isJson || options.yes) {
    const result = await integrateAITools({ projectDir, autoConfirm: true });

    if (isJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printIntegrateHuman(result);
    }
    return;
  }

  // Interactive mode
  if (!hasAnyAIToolFiles(aiTools)) {
    console.log(chalk.yellow("No AI coding tool configuration files found.\n"));
    console.log("Supported files:");
    console.log(chalk.dim("  • CLAUDE.md (Claude Code)"));
    console.log(chalk.dim("  • .cursorrules (Cursor)"));
    console.log(chalk.dim("  • .github/copilot-instructions.md (GitHub Copilot)"));
    console.log(chalk.dim("  • .windsurfrules (Windsurf)"));
    console.log();
    return;
  }

  // Show already integrated
  if (alreadyIntegrated.length > 0) {
    console.log(chalk.green(`Already integrated (${alreadyIntegrated.length}):`));
    alreadyIntegrated.forEach((t) => {
      console.log(chalk.dim(`  ✓ ${t.file.filename} (${t.file.tool})`));
    });
    console.log();
  }

  // If nothing to update
  if (updatable.length === 0) {
    console.log(chalk.green("All detected AI tool files already have Traffical references."));
    return;
  }

  // Show what can be updated
  console.log(`Found ${updatable.length} file${updatable.length !== 1 ? "s" : ""} to update:\n`);
  for (const tool of updatable) {
    console.log(`  • ${tool.file.filename} (${tool.file.tool})`);
  }
  console.log();

  // Ask for confirmation
  const shouldUpdate = await confirm({
    message: "Add Traffical reference to these files?",
    default: true,
  });

  const updated: string[] = [];
  const skipped: string[] = [];

  if (shouldUpdate) {
    for (const tool of updatable) {
      await addTrafficalReference(tool);
      updated.push(tool.file.filename);
    }
  } else {
    skipped.push(...updatable.map((t) => t.file.filename));
  }

  const result: IntegrateAIToolsResult = {
    success: true,
    detected: aiTools.map((t) => ({
      filename: t.file.filename,
      tool: t.file.tool,
      exists: t.exists,
      hasTrafficalReference: t.hasTrafficalReference || updated.includes(t.file.filename),
    })),
    updated,
    skipped,
    alreadyIntegrated: alreadyIntegrated.map((t) => t.file.filename),
  };

  console.log();
  printIntegrateHuman(result);
}


