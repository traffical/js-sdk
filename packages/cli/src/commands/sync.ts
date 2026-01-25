/**
 * sync command
 *
 * Bidirectional sync with "local wins" policy:
 * 1. Validate local config first
 * 2. Push local changes to remote (your edits are applied)
 * 3. Add new remote params to local (params you don't have yet)
 * 4. Warn about conflicts (remote differs from local for same key)
 *
 * This matches the Git workflow: your local file is the source of truth.
 * Supports both human-readable and JSON output.
 */

import chalk from "chalk";
import { exec } from "child_process";
import { promisify } from "util";
import {
  findConfigFile,
  readConfigFile,
  writeConfigFile,
  configParamToApi,
  apiParamToConfig,
  configEventToApi,
  apiEventToConfig,
  TRAFFICAL_DIR,
  CONFIG_FILENAME,
  LEGACY_CONFIG_FILENAME,
} from "../lib/config.ts";
import { ApiClient, ValidationError } from "../lib/api.ts";
import { parseFormatOption } from "../lib/output.ts";
import type { ConfigParameter, ConfigEvent } from "../lib/types.ts";

const execAsync = promisify(exec);

export interface SyncOptions {
  profile?: string;
  configPath?: string;
  apiBase?: string;
  all?: boolean;
  dryRun?: boolean;
  format?: string | boolean;
}

interface ConflictInfo {
  key: string;
  localValue: unknown;
  remoteValue: unknown;
  localType: string;
  remoteType: string;
}

interface EventConflictInfo {
  name: string;
  localValueType: string;
  remoteValueType: string;
}

export interface SyncResult {
  success: boolean;
  project: {
    id: string;
    name: string;
  };
  configPath: string;
  dryRun: boolean;
  push: {
    created: string[];
    updated: string[];
    unchanged: string[];
  };
  pull: {
    added: string[];
  };
  conflicts: ConflictInfo[];
  events: {
    push: {
      created: string[];
      updated: string[];
      unchanged: string[];
    };
    pull: {
      added: string[];
      discovered: string[];
    };
    conflicts: EventConflictInfo[];
  };
}

/**
 * Core sync function (can be used by MCP or other integrations).
 */
export async function syncConfig(options: {
  profile?: string;
  configPath?: string;
  apiBase?: string;
  dryRun?: boolean;
}): Promise<SyncResult> {
  const isDryRun = options.dryRun || false;

  // Find config file
  const configPath = options.configPath || (await findConfigFile());

  if (!configPath) {
    throw new ValidationError(
      `No ${TRAFFICAL_DIR}/config.yaml found. Run 'traffical init' to create one.`
    );
  }

  // Read and validate local config
  const config = await readConfigFile(configPath);
  const projectId = config.project.id;

  // Create API client
  const client = await ApiClient.create({ profile: options.profile, apiBase: options.apiBase });

  // Get project info
  const project = await client.getProject(projectId);

  // Get remote parameters for comparison
  const remoteParams = await client.listParameters(projectId, { synced: true });
  const namespaces = await client.listNamespaces(projectId);
  const namespaceMap = new Map(namespaces.map((ns) => [ns.id, ns]));
  const remoteByKey = new Map(remoteParams.map((p) => [p.key, p]));

  // Convert local params
  const localParams = Object.entries(config.parameters).map(([key, param]) =>
    configParamToApi(key, param)
  );

  // Analyze push changes (local → remote)
  const wouldCreate: string[] = [];
  const wouldUpdate: string[] = [];
  const wouldUnchange: string[] = [];

  for (const param of localParams) {
    const remote = remoteByKey.get(param.key);
    if (!remote) {
      wouldCreate.push(param.key);
    } else if (
      JSON.stringify(remote.defaultValue) !== JSON.stringify(param.default) ||
      remote.type !== param.type
    ) {
      wouldUpdate.push(param.key);
    } else {
      wouldUnchange.push(param.key);
    }
  }

  // Actually push if not dry run
  if (!isDryRun && localParams.length > 0) {
    await client.syncParameters(projectId, {
      parameters: localParams,
      source: "config.yaml",
    });
  }

  // Analyze pull changes (remote → local)
  const newFromRemote: string[] = [];
  const conflicts: ConflictInfo[] = [];
  let configChanged = false;

  for (const param of remoteParams) {
    const namespace = namespaceMap.get(param.namespaceId);
    const { key, config: paramConfig } = apiParamToConfig({
      key: param.key,
      type: param.type,
      defaultValue: param.defaultValue,
      namespace: namespace?.name,
      description: param.description,
    });

    if (!config.parameters[key]) {
      // New param from remote
      newFromRemote.push(key);
      if (!isDryRun) {
        config.parameters[key] = paramConfig;
        configChanged = true;
      }
    } else {
      // Check for conflicts (informational only)
      const existing = config.parameters[key]!;
      const localValue = JSON.stringify(existing.default);
      const remoteValue = JSON.stringify(paramConfig.default);

      if (localValue !== remoteValue || existing.type !== paramConfig.type) {
        conflicts.push({
          key,
          localValue: existing.default,
          remoteValue: paramConfig.default,
          localType: existing.type,
          remoteType: paramConfig.type,
        });
      }
    }
  }

  // ==========================================================================
  // Events Sync
  // ==========================================================================

  // Get remote event definitions for comparison
  const remoteEvents = await client.listEventDefinitions(projectId);
  const remoteEventByName = new Map(remoteEvents.map((e) => [e.name, e]));

  // Convert local events
  const localEvents = Object.entries(config.events || {}).map(([name, event]) =>
    configEventToApi(name, event)
  );

  // Analyze push changes for events (local → remote)
  const eventsWouldCreate: string[] = [];
  const eventsWouldUpdate: string[] = [];
  const eventsWouldUnchange: string[] = [];

  for (const event of localEvents) {
    const remote = remoteEventByName.get(event.name);
    if (!remote) {
      eventsWouldCreate.push(event.name);
    } else if (remote.valueType !== event.valueType || remote.unit !== event.unit) {
      eventsWouldUpdate.push(event.name);
    } else {
      eventsWouldUnchange.push(event.name);
    }
  }

  // Actually push events if not dry run
  if (!isDryRun && localEvents.length > 0) {
    await client.syncEventDefinitions(projectId, {
      events: localEvents,
      source: "config.yaml",
    });
  }

  // Analyze pull changes for events (remote → local)
  const eventsNewFromRemote: string[] = [];
  const eventsDiscovered: string[] = [];
  const eventConflicts: EventConflictInfo[] = [];

  // Initialize events in config if not present
  if (!config.events) {
    config.events = {};
  }

  for (const event of remoteEvents) {
    const { name, config: eventConfig } = apiEventToConfig({
      name: event.name,
      valueType: event.valueType,
      unit: event.unit,
      description: event.description,
    });

    if (!config.events[name]) {
      // New event from remote
      if (event.discovered) {
        eventsDiscovered.push(name);
      } else {
        eventsNewFromRemote.push(name);
      }
      if (!isDryRun) {
        config.events[name] = eventConfig;
        configChanged = true;
      }
    } else {
      // Check for conflicts (informational only)
      const existing = config.events[name]!;

      if (existing.valueType !== eventConfig.valueType) {
        eventConflicts.push({
          name,
          localValueType: existing.valueType,
          remoteValueType: eventConfig.valueType,
        });
      }
    }
  }

  // Save config if changed
  if (configChanged && !isDryRun) {
    await writeConfigFile(configPath, config);
  }

  return {
    success: true,
    project: { id: project.id, name: project.name },
    configPath,
    dryRun: isDryRun,
    push: {
      created: wouldCreate,
      updated: wouldUpdate,
      unchanged: wouldUnchange,
    },
    pull: {
      added: newFromRemote,
    },
    conflicts,
    events: {
      push: {
        created: eventsWouldCreate,
        updated: eventsWouldUpdate,
        unchanged: eventsWouldUnchange,
      },
      pull: {
        added: eventsNewFromRemote,
        discovered: eventsDiscovered,
      },
      conflicts: eventConflicts,
    },
  };
}

/**
 * Print sync result for human-readable output.
 */
function printSyncHuman(result: SyncResult): void {
  console.log(chalk.dim(`Using config: ${result.configPath}`));
  console.log();

  if (result.dryRun) {
    console.log(chalk.cyan("DRY RUN - No changes will be made\n"));
  }

  console.log(chalk.green("✓ Local config valid\n"));
  console.log(`${result.dryRun ? "Would sync" : "Syncing"} with ${chalk.bold(result.project.name)}...\n`);

  // Push results
  console.log(chalk.bold(`${result.dryRun ? "Would change " : ""}Local → Remote:`));

  const { push } = result;
  if (push.created.length === 0 && push.updated.length === 0 && push.unchanged.length === 0) {
    console.log(chalk.dim("  No local parameters to push"));
  } else {
    if (push.created.length > 0) {
      console.log(chalk.green(`  + ${push.created.length} ${result.dryRun ? "would be " : ""}created`));
      push.created.forEach((key) => console.log(chalk.dim(`    ${key}`)));
    }
    if (push.updated.length > 0) {
      console.log(chalk.yellow(`  ~ ${push.updated.length} ${result.dryRun ? "would be " : ""}updated`));
      push.updated.forEach((key) => console.log(chalk.dim(`    ${key}`)));
    }
    if (push.unchanged.length > 0) {
      console.log(chalk.dim(`  = ${push.unchanged.length} ${result.dryRun ? "already in sync" : "unchanged"}`));
    }
  }

  console.log();

  // Pull results
  console.log(chalk.bold(`${result.dryRun ? "Would change " : ""}Remote → Local:`));

  if (result.pull.added.length > 0) {
    console.log(chalk.green(`  + ${result.pull.added.length} ${result.dryRun ? "would be " : ""}added to local config`));
    result.pull.added.forEach((key) => console.log(chalk.dim(`    ${key}`)));
  } else {
    console.log(chalk.dim("  No new parameters from remote"));
  }

  console.log();

  // Conflicts
  if (result.conflicts.length > 0) {
    console.log(chalk.yellow(`⚠ ${result.conflicts.length} conflict${result.conflicts.length !== 1 ? "s" : ""} detected (local version ${result.dryRun ? "would be" : "was"} used):`));
    for (const c of result.conflicts) {
      console.log(chalk.dim(`  ${c.key}:`));
      console.log(chalk.dim(`    local:  ${JSON.stringify(c.localValue)} (${c.localType})`));
      console.log(chalk.dim(`    remote: ${JSON.stringify(c.remoteValue)} (${c.remoteType})`));
    }
    console.log();
    if (!result.dryRun) {
      console.log(chalk.dim("Your local values were pushed. Use 'traffical pull' if you want the remote values."));
      console.log();
    }
  }

  // Events section
  const { events } = result;
  const hasEventActivity =
    events.push.created.length > 0 ||
    events.push.updated.length > 0 ||
    events.pull.added.length > 0 ||
    events.pull.discovered.length > 0 ||
    events.conflicts.length > 0;

  if (hasEventActivity) {
    console.log(chalk.bold.cyan("Events:"));
    console.log();

    // Events push results
    console.log(chalk.bold(`${result.dryRun ? "Would change " : ""}Local → Remote (Events):`));

    if (events.push.created.length === 0 && events.push.updated.length === 0 && events.push.unchanged.length === 0) {
      console.log(chalk.dim("  No local events to push"));
    } else {
      if (events.push.created.length > 0) {
        console.log(chalk.green(`  + ${events.push.created.length} ${result.dryRun ? "would be " : ""}created`));
        events.push.created.forEach((name) => console.log(chalk.dim(`    ${name}`)));
      }
      if (events.push.updated.length > 0) {
        console.log(chalk.yellow(`  ~ ${events.push.updated.length} ${result.dryRun ? "would be " : ""}updated`));
        events.push.updated.forEach((name) => console.log(chalk.dim(`    ${name}`)));
      }
      if (events.push.unchanged.length > 0) {
        console.log(chalk.dim(`  = ${events.push.unchanged.length} ${result.dryRun ? "already in sync" : "unchanged"}`));
      }
    }

    console.log();

    // Events pull results
    console.log(chalk.bold(`${result.dryRun ? "Would change " : ""}Remote → Local (Events):`));

    if (events.pull.added.length > 0) {
      console.log(chalk.green(`  + ${events.pull.added.length} ${result.dryRun ? "would be " : ""}added to local config`));
      events.pull.added.forEach((name) => console.log(chalk.dim(`    ${name}`)));
    }
    if (events.pull.discovered.length > 0) {
      console.log(chalk.cyan(`  ? ${events.pull.discovered.length} discovered event${events.pull.discovered.length !== 1 ? "s" : ""} ${result.dryRun ? "would be " : ""}added`));
      events.pull.discovered.forEach((name) => console.log(chalk.dim(`    ${name}`)));
    }
    if (events.pull.added.length === 0 && events.pull.discovered.length === 0) {
      console.log(chalk.dim("  No new events from remote"));
    }

    console.log();

    // Event conflicts
    if (events.conflicts.length > 0) {
      console.log(chalk.yellow(`⚠ ${events.conflicts.length} event conflict${events.conflicts.length !== 1 ? "s" : ""} detected (local version ${result.dryRun ? "would be" : "was"} used):`));
      for (const c of events.conflicts) {
        console.log(chalk.dim(`  ${c.name}:`));
        console.log(chalk.dim(`    local:  ${c.localValueType}`));
        console.log(chalk.dim(`    remote: ${c.remoteValueType}`));
      }
      console.log();
    }
  }

  if (result.dryRun) {
    console.log(chalk.cyan("✓ Dry run complete - no changes made"));
  } else {
    console.log(chalk.green(`✓ Sync complete`));
  }
}

export async function syncCommand(options: SyncOptions): Promise<void> {
  const format = parseFormatOption(options.format);

  if (options.all) {
    await syncAll(options);
    return;
  }

  const result = await syncConfig(options);

  if (format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printSyncHuman(result);
  }
}

/**
 * Sync all config files in the repository.
 */
async function syncAll(options: SyncOptions): Promise<void> {
  const isDryRun = options.dryRun || false;
  const format = parseFormatOption(options.format);
  const isJson = format === "json";

  if (!isJson && isDryRun) {
    console.log(chalk.cyan("DRY RUN - No changes will be made\n"));
  }

  if (!isJson) {
    console.log("Discovering config files...\n");
  }

  // Find all config files using git or find
  let configFiles: string[] = [];

  try {
    // Try git first (faster, respects .gitignore)
    // Look for both new and legacy paths
    const { stdout } = await execAsync(
      `git ls-files '**/${TRAFFICAL_DIR}/${CONFIG_FILENAME}' '${TRAFFICAL_DIR}/${CONFIG_FILENAME}' '**/${LEGACY_CONFIG_FILENAME}' '${LEGACY_CONFIG_FILENAME}'`
    );
    configFiles = stdout.trim().split("\n").filter(Boolean);
  } catch {
    // Fall back to find
    try {
      const { stdout } = await execAsync(
        `find . \\( -path '*/${TRAFFICAL_DIR}/${CONFIG_FILENAME}' -o -name '${LEGACY_CONFIG_FILENAME}' \\) -not -path '*/node_modules/*'`
      );
      configFiles = stdout.trim().split("\n").filter(Boolean);
    } catch {
      throw new ValidationError("Could not discover config files. Please specify --config explicitly.");
    }
  }

  if (configFiles.length === 0) {
    if (isJson) {
      console.log(JSON.stringify({ success: true, configFiles: [], results: [] }));
    } else {
      console.log(chalk.yellow("No config files found."));
    }
    return;
  }

  if (!isJson) {
    console.log(`Found ${configFiles.length} config file${configFiles.length !== 1 ? "s" : ""}:\n`);
    configFiles.forEach((f) => console.log(chalk.dim(`  ${f}`)));
    console.log();
  }

  // Sync each file
  const results: SyncResult[] = [];

  for (const configPath of configFiles) {
    if (!isJson) {
      console.log(chalk.bold(`\n--- ${configPath} ---\n`));
    }

    const result = await syncConfig({
      profile: options.profile,
      configPath,
      apiBase: options.apiBase,
      dryRun: isDryRun,
    });

    results.push(result);

    if (!isJson) {
      printSyncHuman(result);
    }
  }

  if (isJson) {
    console.log(JSON.stringify({ success: true, configFiles, results }, null, 2));
  } else {
    const verb = isDryRun ? "Validated" : "Synced";
    console.log(chalk.green(`\n✓ ${verb} ${configFiles.length} config file${configFiles.length !== 1 ? "s" : ""}`));
  }
}
