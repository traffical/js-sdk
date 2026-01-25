/**
 * push command
 *
 * Push local config file parameters and events to Traffical.
 * Creates new parameters/events, updates existing ones.
 * Supports both human-readable and JSON output.
 */

import chalk from "chalk";
import { parse } from "yaml";
import { readFile } from "fs/promises";
import {
  findConfigFile,
  configParamToApi,
  configEventToApi,
  validateConfig,
  formatValidationErrors,
  TRAFFICAL_DIR,
} from "../lib/config.ts";
import { ApiClient, ValidationError } from "../lib/api.ts";
import { parseFormatOption } from "../lib/output.ts";
import type { TrafficalConfig } from "../lib/types.ts";

export interface PushOptions {
  profile?: string;
  configPath?: string;
  apiBase?: string;
  dryRun?: boolean;
  format?: string | boolean;
}

export interface PushResult {
  success: boolean;
  project: {
    id: string;
    name: string;
  };
  configPath: string;
  dryRun: boolean;
  created: string[];
  updated: string[];
  unchanged: string[];
  remoteOnly: string[];
  total: number;
  events: {
    created: string[];
    updated: string[];
    unchanged: string[];
    remoteOnly: string[];
    total: number;
  };
}

/**
 * Core push function (can be used by MCP or other integrations).
 */
export async function pushConfig(options: {
  profile?: string;
  configPath?: string;
  apiBase?: string;
  dryRun?: boolean;
}): Promise<PushResult> {
  const isDryRun = options.dryRun || false;

  // Find config file
  const configPath = options.configPath || (await findConfigFile());

  if (!configPath) {
    throw new ValidationError(
      `No ${TRAFFICAL_DIR}/config.yaml found. Run 'traffical init' to create one.`
    );
  }

  // Read and parse YAML
  let parsedConfig: unknown;

  try {
    const rawContent = await readFile(configPath, "utf-8");
    parsedConfig = parse(rawContent);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ValidationError(`Failed to parse ${configPath}: ${message}`);
  }

  // Validate against schema
  const validation = validateConfig(parsedConfig);

  if (!validation.valid) {
    throw new ValidationError(
      `Invalid config file${formatValidationErrors(validation.errors)}`
    );
  }

  const config = parsedConfig as TrafficalConfig;
  const projectId = config.project.id;

  // Create API client
  const client = await ApiClient.create({ profile: options.profile, apiBase: options.apiBase });

  // Get project info
  const project = await client.getProject(projectId);

  // Convert config parameters to API format
  const parameters = Object.entries(config.parameters).map(([key, param]) =>
    configParamToApi(key, param)
  );

  // Convert config events to API format
  const events = Object.entries(config.events || {}).map(([name, event]) =>
    configEventToApi(name, event)
  );

  if (parameters.length === 0 && events.length === 0) {
    return {
      success: true,
      project: { id: project.id, name: project.name },
      configPath,
      dryRun: isDryRun,
      created: [],
      updated: [],
      unchanged: [],
      remoteOnly: [],
      total: 0,
      events: {
        created: [],
        updated: [],
        unchanged: [],
        remoteOnly: [],
        total: 0,
      },
    };
  }

  if (isDryRun) {
    // Dry run: compare parameters with remote
    const remoteParams = await client.listParameters(projectId, { synced: true });
    const remoteKeys = new Map(remoteParams.map((p) => [p.key, p]));

    const created: string[] = [];
    const updated: string[] = [];
    const unchanged: string[] = [];

    for (const param of parameters) {
      const remote = remoteKeys.get(param.key);
      if (!remote) {
        created.push(param.key);
      } else if (
        JSON.stringify(remote.defaultValue) !== JSON.stringify(param.default) ||
        remote.type !== param.type
      ) {
        updated.push(param.key);
      } else {
        unchanged.push(param.key);
      }
    }

    const localKeys = new Set(parameters.map((p) => p.key));
    const remoteOnly = remoteParams.filter((p) => !localKeys.has(p.key)).map((p) => p.key);

    // Dry run: compare events with remote
    const remoteEvents = await client.listEventDefinitions(projectId, { synced: true });
    const remoteEventNames = new Map(remoteEvents.map((e) => [e.name, e]));

    const eventsCreated: string[] = [];
    const eventsUpdated: string[] = [];
    const eventsUnchanged: string[] = [];

    for (const event of events) {
      const remote = remoteEventNames.get(event.name);
      if (!remote) {
        eventsCreated.push(event.name);
      } else if (remote.valueType !== event.valueType || remote.unit !== event.unit) {
        eventsUpdated.push(event.name);
      } else {
        eventsUnchanged.push(event.name);
      }
    }

    const localEventNames = new Set(events.map((e) => e.name));
    const eventsRemoteOnly = remoteEvents.filter((e) => !localEventNames.has(e.name)).map((e) => e.name);

    return {
      success: true,
      project: { id: project.id, name: project.name },
      configPath,
      dryRun: true,
      created,
      updated,
      unchanged,
      remoteOnly,
      total: parameters.length,
      events: {
        created: eventsCreated,
        updated: eventsUpdated,
        unchanged: eventsUnchanged,
        remoteOnly: eventsRemoteOnly,
        total: events.length,
      },
    };
  }

  // Actual push - parameters
  const result = await client.syncParameters(projectId, {
    parameters,
    source: "config.yaml",
  });

  // Actual push - events
  let eventResult = { created: [], updated: [], unchanged: [], remoteOnly: [] } as {
    created: { name: string }[];
    updated: { name: string }[];
    unchanged: { name: string }[];
    remoteOnly: { name: string }[];
  };
  if (events.length > 0) {
    eventResult = await client.syncEventDefinitions(projectId, {
      events,
      source: "config.yaml",
    });
  }

  return {
    success: true,
    project: { id: project.id, name: project.name },
    configPath,
    dryRun: false,
    created: result.created.map((p) => p.key),
    updated: result.updated.map((p) => p.key),
    unchanged: result.unchanged.map((p) => p.key),
    remoteOnly: result.remoteOnly.map((p) => p.key),
    total: parameters.length,
    events: {
      created: eventResult.created.map((e) => e.name),
      updated: eventResult.updated.map((e) => e.name),
      unchanged: eventResult.unchanged.map((e) => e.name),
      remoteOnly: eventResult.remoteOnly.map((e) => e.name),
      total: events.length,
    },
  };
}

/**
 * Print push result for human-readable output.
 */
function printPushHuman(result: PushResult): void {
  console.log(chalk.dim(`Using config: ${result.configPath}\n`));

  if (result.dryRun) {
    console.log(chalk.cyan("DRY RUN - No changes will be made\n"));
    console.log(`Would push to ${chalk.bold(result.project.name)}...\n`);
  } else {
    console.log(`Pushing to ${chalk.bold(result.project.name)}...\n`);
  }

  if (result.total === 0 && result.events.total === 0) {
    console.log(chalk.yellow("No parameters or events in config file."));
    return;
  }

  // Parameters section
  if (result.total > 0) {
    console.log(chalk.bold(result.dryRun ? "Would change (Local → Remote) Parameters:" : "Local → Remote (Parameters):"));

    if (result.created.length > 0) {
      console.log(chalk.green(`  + ${result.created.length} ${result.dryRun ? "would be created" : "created"}`));
      result.created.forEach((key) => console.log(chalk.dim(`    ${key}`)));
    }

    if (result.updated.length > 0) {
      console.log(chalk.yellow(`  ~ ${result.updated.length} ${result.dryRun ? "would be updated" : "updated"}`));
      result.updated.forEach((key) => console.log(chalk.dim(`    ${key}`)));
    }

    if (result.unchanged.length > 0) {
      console.log(chalk.dim(`  = ${result.unchanged.length} ${result.dryRun ? "already in sync" : "unchanged"}`));
    }

    console.log();
  }

  if (result.remoteOnly.length > 0) {
    console.log(chalk.yellow("⚠ Remote-only synced parameters (not in your config):"));
    result.remoteOnly.forEach((key) => console.log(chalk.dim(`  ${key}`)));
    console.log();
    console.log(
      chalk.dim("Run 'traffical pull' to add these to your config, or they will remain synced.")
    );
    console.log();
  }

  // Events section
  if (result.events.total > 0) {
    console.log(chalk.bold(result.dryRun ? "Would change (Local → Remote) Events:" : "Local → Remote (Events):"));

    if (result.events.created.length > 0) {
      console.log(chalk.green(`  + ${result.events.created.length} ${result.dryRun ? "would be created" : "created"}`));
      result.events.created.forEach((name) => console.log(chalk.dim(`    ${name}`)));
    }

    if (result.events.updated.length > 0) {
      console.log(chalk.yellow(`  ~ ${result.events.updated.length} ${result.dryRun ? "would be updated" : "updated"}`));
      result.events.updated.forEach((name) => console.log(chalk.dim(`    ${name}`)));
    }

    if (result.events.unchanged.length > 0) {
      console.log(chalk.dim(`  = ${result.events.unchanged.length} ${result.dryRun ? "already in sync" : "unchanged"}`));
    }

    console.log();
  }

  if (result.events.remoteOnly.length > 0) {
    console.log(chalk.yellow("⚠ Remote-only synced events (not in your config):"));
    result.events.remoteOnly.forEach((name) => console.log(chalk.dim(`  ${name}`)));
    console.log();
    console.log(
      chalk.dim("Run 'traffical pull' to add these to your config, or they will remain synced.")
    );
    console.log();
  }

  if (result.dryRun) {
    console.log(chalk.cyan("✓ Dry run complete - no changes made"));
  } else {
    const parts: string[] = [];
    if (result.total > 0) {
      parts.push(`${result.total} parameter${result.total !== 1 ? "s" : ""}`);
    }
    if (result.events.total > 0) {
      parts.push(`${result.events.total} event${result.events.total !== 1 ? "s" : ""}`);
    }
    console.log(chalk.green(`✓ Pushed ${parts.join(" and ")}`));
  }
}

export async function pushCommand(options: PushOptions): Promise<void> {
  const format = parseFormatOption(options.format);
  const isJson = format === "json";

  if (!isJson) {
    // Validation messages for human output
    const configPath = options.configPath || (await findConfigFile());
    if (configPath) {
      console.log(chalk.dim(`Using config: ${configPath}\n`));
      console.log("Validating configuration...");
    }
  }

  try {
    const result = await pushConfig(options);

    if (isJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      if (!options.dryRun && (result.total > 0 || result.events.total > 0)) {
        console.log(chalk.green("✓ Configuration valid\n"));
      }
      printPushHuman(result);
    }
  } catch (err) {
    if (!isJson && err instanceof ValidationError) {
      console.log(chalk.red(`\n✗ ${err.message}`));
      console.log();
      console.log(chalk.dim("Fix the errors above and try again."));
      console.log(chalk.dim("Schema reference: https://docs.traffical.io/config-as-code/schema"));
    }
    throw err;
  }
}
