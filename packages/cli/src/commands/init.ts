/**
 * init command
 *
 * Initialize Traffical in a project by:
 * 1. Authenticating with an API key
 * 2. Selecting an organization and project
 * 3. Detecting framework
 * 4. Creating .traffical/ directory with:
 *    - config.yaml (with existing synced parameters)
 *    - AGENTS.md (AI agent instructions)
 *    - TEMPLATES.md (framework-specific code patterns)
 * 5. Optionally integrating with AI tool config files
 */

import chalk from "chalk";
import { writeFile } from "fs/promises";
import { join } from "node:path";
import { select, search, confirm, password } from "@inquirer/prompts";
import { setProfile, getProfile } from "../lib/auth.ts";
import { ApiClient } from "../lib/api.ts";
import {
  createConfigFile,
  apiParamToConfig,
  ensureTrafficalDir,
  ensureClaudeSkillDir,
  getDefaultConfigPath,
  getAgentsPath,
  getClaudeSkillPath,
  readAgentsFile,
  hasTrafficalSection,
  TRAFFICAL_DIR,
  CLAUDE_DIR,
  CLAUDE_SKILLS_DIR,
  CLAUDE_SKILL_NAME,
  AGENTS_FILENAME,
} from "../lib/config.ts";
import type { ConfigParameter, ApiOrganization, ApiProject } from "../lib/types.ts";
import {
  detectFramework,
  getFrameworkDisplayName,
  getSdkPackage,
  SUPPORTED_FRAMEWORKS,
  type Framework,
  type Language,
  type DetectedStack,
} from "../lib/detection.ts";
import { generateAgentsMd, updateAgentsMd } from "../lib/agents.ts";
import { generateSkillMd } from "../lib/skill.ts";
import { copyTemplate } from "../lib/templates.ts";
import {
  detectAIToolFiles,
  addTrafficalReference,
  getUpdatableTools,
  type DetectedAITool,
} from "../lib/ai-tools.ts";
import { type OutputFormat, parseFormatOption, output, success } from "../lib/output.ts";

const INTERACTIVE_THRESHOLD = 10;

/**
 * Prompt user to select an organization interactively.
 * Uses arrow selection for ≤10 orgs, search for >10 orgs.
 */
async function selectOrganization(orgs: ApiOrganization[]): Promise<ApiOrganization> {
  if (orgs.length === 1) {
    console.log(chalk.dim(`Using organization: ${orgs[0]!.name}\n`));
    return orgs[0]!;
  }

  const choices = orgs.map((org) => ({
    name: `${org.name} (${org.key})`,
    value: org,
  }));

  if (orgs.length <= INTERACTIVE_THRESHOLD) {
    // Arrow selection for small lists
    return await select({
      message: "Select organization:",
      choices,
    });
  } else {
    // Fuzzy search for large lists
    return await search({
      message: "Search and select organization:",
      source: async (input) => {
        const term = (input || "").toLowerCase();
        return choices.filter(
          (c) =>
            c.value.name.toLowerCase().includes(term) ||
            c.value.key.toLowerCase().includes(term)
        );
      },
    });
  }
}

/**
 * Prompt user to select a project interactively.
 * Uses arrow selection for ≤10 projects, search for >10 projects.
 */
async function selectProject(projects: ApiProject[]): Promise<ApiProject> {
  if (projects.length === 1) {
    console.log(chalk.dim(`Using project: ${projects[0]!.name}\n`));
    return projects[0]!;
  }

  const choices = projects.map((project) => ({
    name: `${project.name} (${project.key})`,
    value: project,
  }));

  if (projects.length <= INTERACTIVE_THRESHOLD) {
    // Arrow selection for small lists
    return await select({
      message: "Select project:",
      choices,
    });
  } else {
    // Fuzzy search for large lists
    return await search({
      message: "Search and select project:",
      source: async (input) => {
        const term = (input || "").toLowerCase();
        return choices.filter(
          (c) =>
            c.value.name.toLowerCase().includes(term) ||
            c.value.key.toLowerCase().includes(term)
        );
      },
    });
  }
}

export interface StackSelection {
  framework: Framework;
  language: Language;
  skipped: boolean;
}

/**
 * Prompt user to confirm or select a framework and language.
 */
async function confirmOrSelectStack(detected: DetectedStack): Promise<StackSelection> {
  const frameworkName = getFrameworkDisplayName(detected.framework);
  const languageName = detected.language === "typescript" ? "TypeScript" : "JavaScript";

  // Explain what this step is for
  console.log(chalk.bold("Stack Detection\n"));
  console.log(chalk.dim("We'll use this to:"));
  console.log(chalk.dim("  • Generate code templates for your framework"));
  console.log(chalk.dim("  • Create SDK usage examples in AGENTS.md and SKILL.md"));
  console.log(chalk.dim("  • Recommend the right SDK package\n"));

  if (detected.confidence === "high") {
    // High confidence - show what we detected and offer to change
    console.log(`Detected: ${chalk.cyan(languageName)} + ${chalk.cyan(frameworkName)}`);
    console.log(chalk.dim(`  (based on: ${detected.signals.join(", ")})\n`));

    const useDetected = await confirm({
      message: "Use detected stack?",
      default: true,
    });

    if (useDetected) {
      return {
        framework: detected.framework,
        language: detected.language,
        skipped: false,
      };
    }
  } else if (detected.framework !== "unknown") {
    // Medium/low confidence - ask to confirm
    console.log(`Detected: ${chalk.cyan(languageName)} + ${chalk.cyan(frameworkName)} ${chalk.dim("(not certain)")}\n`);

    const useDetected = await confirm({
      message: `Use ${frameworkName}?`,
      default: true,
    });

    if (useDetected) {
      return {
        framework: detected.framework,
        language: detected.language,
        skipped: false,
      };
    }
  } else {
    console.log(chalk.dim("Could not auto-detect framework.\n"));
  }

  // Build choices with skip option
  const frameworkChoices = [
    ...SUPPORTED_FRAMEWORKS.map((f) => ({
      name: f.name,
      value: f.value,
    })),
    {
      name: chalk.dim("Skip (use generic templates)"),
      value: "skip" as const,
    },
  ];

  const frameworkChoice = await select({
    message: "Select your framework:",
    choices: frameworkChoices,
  });

  if (frameworkChoice === "skip") {
    return {
      framework: "node", // Default to node for generic templates
      language: detected.language,
      skipped: true,
    };
  }

  // Ask about language if they selected a framework
  const languageChoice = await select({
    message: "Select your language:",
    choices: [
      { name: "TypeScript", value: "typescript" as Language },
      { name: "JavaScript", value: "javascript" as Language },
    ],
    default: detected.language,
  });

  return {
    framework: frameworkChoice,
    language: languageChoice,
    skipped: false,
  };
}

/**
 * Handle AI tool file integration.
 */
async function handleAIToolIntegration(projectDir: string): Promise<string[]> {
  const updatedFiles: string[] = [];
  const aiTools = await detectAIToolFiles(projectDir);
  const updatable = getUpdatableTools(aiTools);

  if (updatable.length === 0) {
    return updatedFiles;
  }

  console.log();
  console.log(chalk.bold("AI Tool Integration"));
  console.log(chalk.dim("Found AI coding tool configuration files:\n"));

  for (const tool of updatable) {
    console.log(`  • ${tool.file.filename} (${tool.file.tool})`);
  }
  console.log();

  const shouldUpdate = await confirm({
    message: "Add Traffical reference to these files?",
    default: true,
  });

  if (shouldUpdate) {
    for (const tool of updatable) {
      await addTrafficalReference(tool);
      updatedFiles.push(tool.file.filename);
    }
  }

  return updatedFiles;
}

export interface InitOptions {
  profile?: string;
  apiKey?: string;
  apiBase?: string;
  format?: string | boolean;
}

export interface InitResult {
  success: boolean;
  project: {
    id: string;
    name: string;
    key: string;
  };
  org: {
    id: string;
    name: string;
    key: string;
  };
  framework: {
    detected: Framework;
    language: string;
    sdkPackage: string;
  };
  files: {
    config: string;
    agents: string;
    skill: string;
    templates: string;
  };
  parameters: number;
  aiToolsUpdated: string[];
}

export async function initCommand(options: InitOptions): Promise<void> {
  const format = parseFormatOption(options.format);
  const isJson = format === "json";

  if (!isJson) {
    console.log(chalk.bold("\n🚀 Welcome to Traffical!\n"));
    console.log("Let's set up your project.\n");
  }

  // Step 1: Get and validate API key
  const profileName = options.profile || "default";
  const existingProfile = await getProfile(options.profile);
  let apiKey = options.apiKey;
  let validation: Awaited<ReturnType<typeof ApiClient.prototype.validateKey>> | null = null;

  // Try API key from --api-key flag first
  if (apiKey) {
    if (!isJson) {
      console.log("Validating API key...");
    }
    const client = await ApiClient.create({ apiKey, apiBase: options.apiBase });
    validation = await client.validateKey();

    if (!validation.valid) {
      if (isJson) {
        throw new Error("Invalid API key provided via --api-key flag");
      }
      console.log(chalk.red("\n✗ Invalid API key\n"));
      console.log("Possible issues:");
      console.log("  • Key may have been revoked or expired");
      console.log("  • Key may have been copied incorrectly");
      console.log("  • Key may be for a different environment\n");
      console.log(chalk.dim("Get a new key at:"));
      console.log(chalk.cyan("  https://dashboard.traffical.io/settings/api-keys\n"));
      throw new Error("API key validation failed");
    }

    if (!isJson) {
      console.log(chalk.green(`✓ Authenticated${validation.email ? ` as ${validation.email}` : ""}\n`));
    }
  }

  // Try existing profile if no --api-key was provided
  if (!apiKey && existingProfile) {
    if (!isJson) {
      console.log(chalk.dim(`Found saved profile${options.profile ? ` "${options.profile}"` : ""}`));
      console.log("Validating saved API key...");
    }

    const client = await ApiClient.create({ apiKey: existingProfile.api_key, apiBase: options.apiBase });
    validation = await client.validateKey();

    if (validation.valid) {
      apiKey = existingProfile.api_key;
      if (!isJson) {
        console.log(chalk.green(`✓ Authenticated${validation.email ? ` as ${validation.email}` : ""}\n`));
      }
    } else {
      if (!isJson) {
        console.log(chalk.yellow("⚠ Saved API key is no longer valid\n"));
      }
      // Fall through to prompt for new key
    }
  }

  // Prompt for API key if we don't have a valid one
  if (!apiKey) {
    if (isJson) {
      throw new Error(
        "No valid API key found. Provide one with --api-key <key>"
      );
    }

    console.log(chalk.bold("API Key Required\n"));
    console.log(chalk.dim("Get your API key from:"));
    console.log(chalk.cyan("  https://dashboard.traffical.io/settings/api-keys\n"));

    // Keep prompting until we get a valid key
    let keyValid = false;
    while (!keyValid) {
      apiKey = await password({
        message: "Paste your API key:",
        mask: "•",
        validate: (value) => {
          if (!value || value.trim().length === 0) {
            return "API key is required";
          }
          if (!value.startsWith("traffical_sk_")) {
            return "API key should start with 'traffical_sk_'";
          }
          return true;
        },
      });

      console.log("\nValidating API key...");
      const client = await ApiClient.create({ apiKey, apiBase: options.apiBase });
      validation = await client.validateKey();

      if (validation.valid) {
        keyValid = true;
        console.log(chalk.green(`✓ Authenticated${validation.email ? ` as ${validation.email}` : ""}\n`));
      } else {
        console.log(chalk.red("\n✗ Invalid API key\n"));
        console.log("Possible issues:");
        console.log("  • Key may have been revoked or expired");
        console.log("  • Key may have been copied incorrectly\n");

        const tryAgain = await confirm({
          message: "Would you like to try a different API key?",
          default: true,
        });

        if (!tryAgain) {
          throw new Error("API key validation failed");
        }
        console.log();
      }
    }
  }

  // At this point apiKey is guaranteed to be set (we threw or looped until valid)
  if (!apiKey) {
    throw new Error("Unexpected state: apiKey is undefined after successful auth");
  }

  // Save the valid API key to profile
  await setProfile(profileName, {
    api_key: apiKey,
    api_base: options.apiBase,
  });
  if (!isJson) {
    console.log(chalk.dim(`Saved API key to ~/.trafficalrc (profile: ${profileName})${options.apiBase ? ` with API base: ${options.apiBase}` : ""}\n`));
  }

  // Create the API client with the validated key
  const client = await ApiClient.create({ apiKey, apiBase: options.apiBase });

  // At this point validation is guaranteed to be set
  if (!validation) {
    throw new Error("Unexpected state: validation is null after successful auth");
  }

  let selectedOrg: Awaited<ReturnType<typeof client.getOrganization>>;
  let selectedProject: Awaited<ReturnType<typeof client.getProject>>;

  if (validation.authType === "apikey" && validation.orgId) {
    // API key auth - use the org/project from the key
    if (!isJson) {
      console.log(chalk.dim("Using organization from API key..."));
    }
    selectedOrg = await client.getOrganization(validation.orgId);
    if (!isJson) {
      console.log(chalk.dim(`Organization: ${selectedOrg.name}\n`));
    }

    if (validation.projectId) {
      // Project-scoped API key - use that project
      if (!isJson) {
        console.log(chalk.dim("Using project from API key..."));
      }
      selectedProject = await client.getProject(validation.projectId);
      if (!isJson) {
        console.log(chalk.dim(`Project: ${selectedProject.name}\n`));
      }
    } else {
      // Org-scoped API key - list projects and let user select
      const projects = await client.listProjects(selectedOrg.id);

      if (projects.length === 0) {
        throw new Error(
          `No projects found in ${selectedOrg.name}. Create one at https://app.traffical.io`
        );
      }

      selectedProject = await selectProject(projects);
      if (!isJson) {
        console.log(chalk.green(`✓ Selected project: ${selectedProject.name}\n`));
      }
    }
  } else {
    // User auth - list organizations and let user select
    const orgs = await client.listOrganizations();

    if (orgs.length === 0) {
      throw new Error("No organizations found. Create one at https://app.traffical.io");
    }

    selectedOrg = await selectOrganization(orgs);
    if (!isJson) {
      console.log(chalk.green(`✓ Selected organization: ${selectedOrg.name}\n`));
    }

    // List projects and let user select
    const projects = await client.listProjects(selectedOrg.id);

    if (projects.length === 0) {
      throw new Error(
        `No projects found in ${selectedOrg.name}. Create one at https://app.traffical.io`
      );
    }

    selectedProject = await selectProject(projects);
    if (!isJson) {
      console.log(chalk.green(`✓ Selected project: ${selectedProject.name}\n`));
    }
  }

  // Detect framework and language
  const projectDir = process.cwd();
  const detected = await detectFramework(projectDir);
  
  let stackSelection: StackSelection;
  if (isJson) {
    // In JSON mode, use auto-detected values without prompting
    stackSelection = {
      framework: detected.framework === "unknown" ? "node" : detected.framework,
      language: detected.language,
      skipped: detected.framework === "unknown",
    };
  } else {
    stackSelection = await confirmOrSelectStack(detected);
  }

  const { framework, language, skipped: stackSkipped } = stackSelection;
  const frameworkName = getFrameworkDisplayName(framework);
  const languageName = language === "typescript" ? "TypeScript" : "JavaScript";
  const sdkPackage = getSdkPackage(framework);

  if (!isJson) {
    if (stackSkipped) {
      console.log(chalk.dim("Skipped stack selection, using generic templates\n"));
    } else {
      console.log(chalk.green(`✓ Using ${languageName} + ${frameworkName}\n`));
    }
  }

  // Get existing synced parameters
  const parameters = await client.listParameters(selectedProject.id, { synced: true });
  const namespaces = await client.listNamespaces(selectedProject.id);
  const namespaceMap = new Map(namespaces.map((ns) => [ns.id, ns]));

  // Convert to config format
  const configParams: Record<string, ConfigParameter> = {};
  for (const param of parameters) {
    const namespace = namespaceMap.get(param.namespaceId);
    const { key, config } = apiParamToConfig({
      key: param.key,
      type: param.type,
      defaultValue: param.defaultValue,
      namespace: namespace?.name,
      description: param.description,
    });
    configParams[key] = config;
  }

  // Create .traffical directory and files
  if (!isJson) {
    console.log(chalk.bold("Creating Traffical Configuration"));
  }

  await ensureTrafficalDir(projectDir);
  const configPath = getDefaultConfigPath(projectDir);
  const agentsPath = getAgentsPath(projectDir);
  const templatesPath = join(projectDir, TRAFFICAL_DIR, "TEMPLATES.md");

  // Create config.yaml
  await createConfigFile(configPath, {
    projectId: selectedProject.id,
    projectName: selectedProject.name,
    orgId: selectedOrg.id,
    orgName: selectedOrg.name,
    parameters: configParams,
  });

  if (!isJson) {
    console.log(chalk.green(`✓ Created ${TRAFFICAL_DIR}/config.yaml`));
    if (parameters.length > 0) {
      console.log(chalk.dim(`  Imported ${parameters.length} synced parameter${parameters.length !== 1 ? "s" : ""}`));
    }
  }

  // Generate or update AGENTS.md at project root (for OpenAI Codex CLI and other AI tools)
  const agentsMdOptions = {
    projectName: selectedProject.name,
    orgName: selectedOrg.name,
    framework,
    language,
    parameters: configParams,
  };

  const existingAgentsContent = await readAgentsFile(projectDir);
  let agentsAction: "created" | "updated" | "unchanged";

  if (existingAgentsContent === null) {
    // No existing file - create new
    const agentsContent = generateAgentsMd(agentsMdOptions);
    await writeFile(agentsPath, agentsContent, "utf-8");
    agentsAction = "created";
  } else if (hasTrafficalSection(existingAgentsContent)) {
    // File exists with Traffical section - update it
    const updatedContent = updateAgentsMd(existingAgentsContent, agentsMdOptions);
    await writeFile(agentsPath, updatedContent, "utf-8");
    agentsAction = "updated";
  } else {
    // File exists without Traffical section - append
    const updatedContent = updateAgentsMd(existingAgentsContent, agentsMdOptions);
    await writeFile(agentsPath, updatedContent, "utf-8");
    agentsAction = "updated";
  }

  if (!isJson) {
    if (agentsAction === "created") {
      console.log(chalk.green(`✓ Created ${AGENTS_FILENAME}`));
    } else {
      console.log(chalk.green(`✓ Updated ${AGENTS_FILENAME}`));
      console.log(chalk.dim(`  Added Traffical section to existing file`));
    }
  }

  // Copy framework-specific template
  await copyTemplate(join(projectDir, TRAFFICAL_DIR), framework);

  if (!isJson) {
    console.log(chalk.green(`✓ Created ${TRAFFICAL_DIR}/TEMPLATES.md`));
  }

  // Create .claude/skills/traffical/SKILL.md for Claude Code discovery
  await ensureClaudeSkillDir(projectDir);
  const skillPath = getClaudeSkillPath(projectDir);
  const skillContent = generateSkillMd({
    projectName: selectedProject.name,
    orgName: selectedOrg.name,
    framework,
    language,
    parameters: configParams,
  });
  await writeFile(skillPath, skillContent, "utf-8");

  if (!isJson) {
    console.log(chalk.green(`✓ Created ${CLAUDE_DIR}/${CLAUDE_SKILLS_DIR}/${CLAUDE_SKILL_NAME}/SKILL.md`));
    console.log(chalk.dim(`  Claude Code will auto-discover this Skill`));
  }

  // Handle AI tool integration
  const aiToolsUpdated = await handleAIToolIntegration(projectDir);

  if (!isJson && aiToolsUpdated.length > 0) {
    console.log();
    for (const file of aiToolsUpdated) {
      console.log(chalk.green(`✓ Updated ${file}`));
    }
  }

  // Output result
  const result: InitResult = {
    success: true,
    project: {
      id: selectedProject.id,
      name: selectedProject.name,
      key: selectedProject.key,
    },
    org: {
      id: selectedOrg.id,
      name: selectedOrg.name,
      key: selectedOrg.key,
    },
    framework: {
      detected: framework,
      language,
      sdkPackage,
    },
    files: {
      config: configPath,
      agents: agentsPath,
      skill: skillPath,
      templates: templatesPath,
    },
    parameters: parameters.length,
    aiToolsUpdated,
  };

  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log();
    console.log(chalk.bold("Next steps:"));
    console.log(`  1. Review ${TRAFFICAL_DIR}/config.yaml`);
    console.log(`  2. See code patterns in ${TRAFFICAL_DIR}/TEMPLATES.md`);
    console.log(`  3. Install SDK: ${chalk.cyan(`npm install ${sdkPackage}`)}`);
    console.log(`  4. Run ${chalk.cyan("traffical status")} to check sync status`);
    console.log();
    console.log(chalk.dim("AI Integration:"));
    console.log(chalk.dim(`  • Claude Code will auto-discover ${CLAUDE_DIR}/${CLAUDE_SKILLS_DIR}/${CLAUDE_SKILL_NAME}/`));
    console.log(chalk.dim(`  • OpenAI Codex CLI and other tools can read ${AGENTS_FILENAME}`));
    console.log();
    console.log(chalk.dim("Learn more: https://docs.traffical.io/config-as-code"));
    console.log();
  }
}
