/**
 * pull command
 *
 * Pull synced parameters from Traffical to local config file.
 * Updates config.yaml with remote synced parameters.
 * Supports both human-readable and JSON output.
 */

import chalk from "chalk";
import {
  findConfigFile,
  readConfigFile,
  writeConfigFile,
  apiParamToConfig,
  apiEventToConfig,
  TRAFFICAL_DIR,
} from "../lib/config.ts";
import { ApiClient, ValidationError } from "../lib/api.ts";
import { parseFormatOption } from "../lib/output.ts";
import type { ConfigParameter, ConfigEvent } from "../lib/types.ts";

export interface PullOptions {
  profile?: string;
  configPath?: string;
  apiBase?: string;
  format?: string | boolean;
}

export interface PullResult {
  success: boolean;
  project: {
    id: string;
    name: string;
  };
  configPath: string;
  added: string[];
  updated: string[];
  unchanged: string[];
  localOnly: string[];
  total: number;
  events: {
    added: string[];
    updated: string[];
    unchanged: string[];
    discovered: string[];
    localOnly: string[];
    total: number;
  };
}

/**
 * Core pull function (can be used by MCP or other integrations).
 */
export async function pullConfig(options: {
  profile?: string;
  configPath?: string;
  apiBase?: string;
}): Promise<PullResult> {
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

  // Get project info
  const project = await client.getProject(projectId);

  // Get synced parameters from API
  const parameters = await client.listParameters(projectId, { synced: true });
  const namespaces = await client.listNamespaces(projectId);
  const namespaceMap = new Map(namespaces.map((ns) => [ns.id, ns]));

  // Track changes
  const added: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];

  // Build new parameters object
  const newParams: Record<string, ConfigParameter> = {};

  for (const param of parameters) {
    const namespace = namespaceMap.get(param.namespaceId);
    const { key, config: paramConfig } = apiParamToConfig({
      key: param.key,
      type: param.type,
      defaultValue: param.defaultValue,
      namespace: namespace?.name,
      description: param.description,
    });

    const existing = config.parameters[key];

    if (!existing) {
      added.push(key);
    } else if (
      JSON.stringify(existing.default) !== JSON.stringify(paramConfig.default) ||
      existing.type !== paramConfig.type ||
      existing.description !== paramConfig.description
    ) {
      updated.push(key);
    } else {
      unchanged.push(key);
    }

    newParams[key] = paramConfig;
  }

  // Preserve local-only parameters (not synced)
  const localOnly: string[] = [];
  for (const [key, param] of Object.entries(config.parameters)) {
    if (!newParams[key]) {
      newParams[key] = param;
      localOnly.push(key);
    }
  }

  // Update config
  config.parameters = newParams;

  // ==========================================================================
  // Events Pull
  // ==========================================================================

  // Get event definitions from API (including discovered ones)
  const eventDefinitions = await client.listEventDefinitions(projectId);

  // Track event changes
  const eventsAdded: string[] = [];
  const eventsUpdated: string[] = [];
  const eventsUnchanged: string[] = [];
  const eventsDiscovered: string[] = [];

  // Build new events object
  const newEvents: Record<string, ConfigEvent> = {};

  for (const event of eventDefinitions) {
    const { name, config: eventConfig } = apiEventToConfig({
      name: event.name,
      valueType: event.valueType,
      unit: event.unit,
      description: event.description,
    });

    const existing = config.events?.[name];

    if (!existing) {
      if (event.discovered) {
        eventsDiscovered.push(name);
      } else {
        eventsAdded.push(name);
      }
    } else if (
      existing.valueType !== eventConfig.valueType ||
      existing.unit !== eventConfig.unit ||
      existing.description !== eventConfig.description
    ) {
      eventsUpdated.push(name);
    } else {
      eventsUnchanged.push(name);
    }

    newEvents[name] = eventConfig;
  }

  // Preserve local-only events (not synced)
  const eventsLocalOnly: string[] = [];
  for (const [name, event] of Object.entries(config.events || {})) {
    if (!newEvents[name]) {
      newEvents[name] = event;
      eventsLocalOnly.push(name);
    }
  }

  config.events = newEvents;
  await writeConfigFile(configPath, config);

  return {
    success: true,
    project: { id: project.id, name: project.name },
    configPath,
    added,
    updated,
    unchanged,
    localOnly,
    total: parameters.length,
    events: {
      added: eventsAdded,
      updated: eventsUpdated,
      unchanged: eventsUnchanged,
      discovered: eventsDiscovered,
      localOnly: eventsLocalOnly,
      total: eventDefinitions.length,
    },
  };
}

/**
 * Print pull result for human-readable output.
 */
function printPullHuman(result: PullResult): void {
  console.log(chalk.dim(`Using config: ${result.configPath}`));
  console.log();
  console.log(`Pulling from ${chalk.bold(result.project.name)}...\n`);

  console.log(chalk.bold("Remote → Local (Parameters):"));

  if (result.added.length > 0) {
    console.log(chalk.green(`  + ${result.added.length} added`));
    result.added.forEach((key) => {
      console.log(chalk.dim(`    ${key}`));
    });
  }

  if (result.updated.length > 0) {
    console.log(chalk.yellow(`  ~ ${result.updated.length} updated`));
    result.updated.forEach((key) => {
      console.log(chalk.dim(`    ${key}`));
    });
  }

  if (result.unchanged.length > 0) {
    console.log(chalk.dim(`  = ${result.unchanged.length} unchanged`));
  }

  if (result.localOnly.length > 0) {
    console.log(chalk.cyan(`  ? ${result.localOnly.length} local-only (not yet pushed)`));
    result.localOnly.forEach((key) => {
      console.log(chalk.dim(`    ${key}`));
    });
  }

  console.log();

  // Events section
  const { events } = result;
  const hasEventActivity =
    events.added.length > 0 ||
    events.updated.length > 0 ||
    events.discovered.length > 0 ||
    events.localOnly.length > 0;

  if (hasEventActivity || events.total > 0) {
    console.log(chalk.bold("Remote → Local (Events):"));

    if (events.added.length > 0) {
      console.log(chalk.green(`  + ${events.added.length} added`));
      events.added.forEach((name) => {
        console.log(chalk.dim(`    ${name}`));
      });
    }

    if (events.updated.length > 0) {
      console.log(chalk.yellow(`  ~ ${events.updated.length} updated`));
      events.updated.forEach((name) => {
        console.log(chalk.dim(`    ${name}`));
      });
    }

    if (events.discovered.length > 0) {
      console.log(chalk.cyan(`  ? ${events.discovered.length} discovered (auto-detected from tracking)`));
      events.discovered.forEach((name) => {
        console.log(chalk.dim(`    ${name}`));
      });
    }

    if (events.unchanged.length > 0) {
      console.log(chalk.dim(`  = ${events.unchanged.length} unchanged`));
    }

    if (events.localOnly.length > 0) {
      console.log(chalk.cyan(`  ? ${events.localOnly.length} local-only (not yet pushed)`));
      events.localOnly.forEach((name) => {
        console.log(chalk.dim(`    ${name}`));
      });
    }

    console.log();
  }

  console.log(chalk.green(`✓ Updated config.yaml`));

  const hasLocalOnly = result.localOnly.length > 0 || events.localOnly.length > 0;
  if (hasLocalOnly) {
    console.log();
    console.log(chalk.dim("Run 'traffical push' to sync local-only parameters/events."));
  }
}

export async function pullCommand(options: PullOptions): Promise<void> {
  const format = parseFormatOption(options.format);
  const result = await pullConfig(options);

  if (format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printPullHuman(result);
  }
}
