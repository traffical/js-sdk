/**
 * import command
 *
 * Add a dashboard-only parameter to the local config file.
 * Supports wildcard patterns (e.g., ui.*, ui.*Color, *.enabled)
 * Supports both human-readable and JSON output.
 */

import chalk from "chalk";
import {
  findConfigFile,
  readConfigFile,
  upsertParameter,
  apiParamToConfig,
  TRAFFICAL_DIR,
} from "../lib/config.ts";
import { ApiClient, ValidationError } from "../lib/api.ts";
import { parseFormatOption } from "../lib/output.ts";
import type { ApiParameter } from "../lib/types.ts";

export interface ImportOptions {
  profile?: string;
  configPath?: string;
  apiBase?: string;
  key: string;
  format?: string | boolean;
}

export interface ImportResult {
  success: boolean;
  pattern: string;
  isWildcard: boolean;
  imported: Array<{
    key: string;
    type: string;
    default: unknown;
    namespace?: string;
    description?: string;
  }>;
  skipped: {
    alreadyInConfig: string[];
    alreadySynced: string[];
  };
  available?: string[];
}

/**
 * Check if a pattern contains wildcards.
 */
function isWildcardPattern(pattern: string): boolean {
  return pattern.includes("*");
}

/**
 * Convert a wildcard pattern to a RegExp.
 * Supports * as a wildcard that matches any characters.
 */
function patternToRegex(pattern: string): RegExp {
  // Escape special regex characters except *
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  // Replace * with regex wildcard
  const regexPattern = escaped.replace(/\*/g, ".*");
  return new RegExp(`^${regexPattern}$`);
}

/**
 * Find parameters matching a pattern (exact match or wildcard).
 */
function findMatchingParams(
  pattern: string,
  params: ApiParameter[]
): ApiParameter[] {
  if (isWildcardPattern(pattern)) {
    const regex = patternToRegex(pattern);
    return params.filter((p) => regex.test(p.key));
  } else {
    const param = params.find((p) => p.key === pattern);
    return param ? [param] : [];
  }
}

/**
 * Core import function (can be used by MCP or other integrations).
 */
export async function importParam(options: {
  profile?: string;
  configPath?: string;
  apiBase?: string;
  key: string;
}): Promise<ImportResult> {
  // Find config file
  const configPath = options.configPath || (await findConfigFile());

  if (!configPath) {
    throw new ValidationError(
      `No ${TRAFFICAL_DIR}/config.yaml found. Run 'traffical init' to create one.`
    );
  }

  // Read config
  const config = await readConfigFile(configPath);
  const projectId = config.project.id;

  // Create API client
  const client = await ApiClient.create({ profile: options.profile, apiBase: options.apiBase });

  // Get all parameters from API
  const allParams = await client.listParameters(projectId);
  const namespaces = await client.listNamespaces(projectId);
  const namespaceMap = new Map(namespaces.map((ns) => [ns.id, ns]));

  const isWildcard = isWildcardPattern(options.key);

  // Find matching parameters
  const matchingParams = findMatchingParams(options.key, allParams);

  if (matchingParams.length === 0) {
    return {
      success: false,
      pattern: options.key,
      isWildcard,
      imported: [],
      skipped: { alreadyInConfig: [], alreadySynced: [] },
      available: allParams.map((p) => p.key),
    };
  }

  // Filter out params already in config or already synced
  const toImport: ApiParameter[] = [];
  const skippedInConfig: string[] = [];
  const skippedSynced: string[] = [];

  for (const param of matchingParams) {
    if (config.parameters[param.key]) {
      skippedInConfig.push(param.key);
    } else if (param.synced) {
      skippedSynced.push(param.key);
    } else {
      toImport.push(param);
    }
  }

  // Import all matching parameters
  const imported: ImportResult["imported"] = [];

  for (const param of toImport) {
    const namespace = namespaceMap.get(param.namespaceId);
    const { config: paramConfig } = apiParamToConfig({
      key: param.key,
      type: param.type,
      defaultValue: param.defaultValue,
      namespace: namespace?.name,
      description: param.description,
    });

    // Add to config file
    await upsertParameter(configPath, param.key, paramConfig);

    imported.push({
      key: param.key,
      type: paramConfig.type,
      default: paramConfig.default,
      namespace: paramConfig.namespace,
      description: paramConfig.description,
    });
  }

  return {
    success: true,
    pattern: options.key,
    isWildcard,
    imported,
    skipped: {
      alreadyInConfig: skippedInConfig,
      alreadySynced: skippedSynced,
    },
  };
}

/**
 * Print import result for human-readable output.
 */
function printImportHuman(result: ImportResult, options: ImportOptions): void {
  if (!result.success && result.available) {
    // No matches found
    if (result.isWildcard) {
      console.log(chalk.red(`No parameters matching '${result.pattern}' found.\n`));
    } else {
      console.log(chalk.red(`Parameter '${result.pattern}' not found in project.\n`));
    }
    console.log("Available parameters:");
    result.available.forEach((key) => {
      console.log(chalk.dim(`  ${key}`));
    });
    console.log();
    console.log(chalk.dim("Tip: Use wildcards to import multiple parameters at once:"));
    console.log(chalk.dim("  traffical import 'ui.*'        # All params starting with ui."));
    console.log(chalk.dim("  traffical import '*.enabled'   # All params ending with .enabled"));
    console.log(chalk.dim("  traffical import 'ui.*Color'   # Params like ui.buttonColor, ui.textColor"));
    return;
  }

  const { skipped } = result;
  const totalMatched = result.imported.length + skipped.alreadyInConfig.length + skipped.alreadySynced.length;

  // Report on matches when using wildcards
  if (result.isWildcard) {
    console.log(`Pattern '${result.pattern}' matched ${totalMatched} parameter${totalMatched !== 1 ? "s" : ""}:\n`);
  }

  // Handle single parameter (non-wildcard) special cases
  if (!result.isWildcard) {
    if (skipped.alreadyInConfig.length > 0) {
      console.log(chalk.yellow(`Parameter '${result.pattern}' already exists in config.yaml`));
      return;
    }
    if (skipped.alreadySynced.length > 0) {
      console.log(chalk.yellow(`Parameter '${result.pattern}' is already synced.`));
      console.log(chalk.dim("Run 'traffical pull' to update your config file."));
      return;
    }
  }

  // Report skipped parameters for wildcards
  if (result.isWildcard) {
    if (skipped.alreadyInConfig.length > 0) {
      console.log(chalk.dim(`Skipping ${skipped.alreadyInConfig.length} already in config:`));
      skipped.alreadyInConfig.forEach((key) => console.log(chalk.dim(`  ${key}`)));
      console.log();
    }
    if (skipped.alreadySynced.length > 0) {
      console.log(chalk.dim(`Skipping ${skipped.alreadySynced.length} already synced:`));
      skipped.alreadySynced.forEach((key) => console.log(chalk.dim(`  ${key}`)));
      console.log();
    }
  }

  if (result.imported.length === 0) {
    console.log(chalk.yellow("No new parameters to import."));
    if (skipped.alreadySynced.length > 0) {
      console.log(chalk.dim("Run 'traffical pull' to update synced parameters in your config."));
    }
    return;
  }

  // Import results
  console.log(chalk.green(`✓ Adding ${result.imported.length} parameter${result.imported.length !== 1 ? "s" : ""} to config.yaml:\n`));

  for (const param of result.imported) {
    console.log(chalk.cyan(`  ${param.key}:`));
    console.log(chalk.dim(`    type: ${param.type}`));
    console.log(chalk.dim(`    default: ${JSON.stringify(param.default)}`));
    if (param.namespace) {
      console.log(chalk.dim(`    namespace: ${param.namespace}`));
    }
    if (param.description) {
      console.log(chalk.dim(`    description: "${param.description}"`));
    }
    console.log();
  }

  console.log(chalk.dim("Run 'traffical push' to mark them as synced."));
}

export async function importCommand(options: ImportOptions): Promise<void> {
  const format = parseFormatOption(options.format);

  // Find config file (for logging in human mode)
  const configPath = options.configPath || (await findConfigFile());
  if (format !== "json") {
    console.log(chalk.dim(`Using config: ${configPath}\n`));
  }

  const result = await importParam(options);

  if (format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printImportHuman(result, options);
  }

  if (!result.success) {
    throw new ValidationError(`No parameters matching '${options.key}'`);
  }
}
