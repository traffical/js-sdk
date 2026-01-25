/**
 * Config File Parser
 *
 * Reads and writes Traffical config files.
 * Supports both new .traffical/config.yaml and legacy traffical.yaml paths.
 */

import { parse, stringify } from "yaml";
import { readFile, writeFile, access, mkdir } from "fs/promises";
import { join, dirname } from "path";
import Ajv from "ajv";
import type {
  TrafficalConfig,
  ConfigParameter,
  ConfigEvent,
  ParameterType,
  ParameterValue,
  EventValueType,
} from "./types.ts";

// Import the JSON Schema
import configSchema from "../../schemas/traffical-config.schema.json";

/** Directory name for Traffical config */
export const TRAFFICAL_DIR = ".traffical";

/** Config filename within .traffical directory */
export const CONFIG_FILENAME = "config.yaml";

/** Legacy config filename (for backwards compatibility) */
export const LEGACY_CONFIG_FILENAME = "traffical.yaml";

/** AGENTS.md filename (legacy, for backwards compatibility) */
export const AGENTS_FILENAME = "AGENTS.md";

/** Templates filename */
export const TEMPLATES_FILENAME = "TEMPLATES.md";

/** Claude Code Skills directory */
export const CLAUDE_DIR = ".claude";
export const CLAUDE_SKILLS_DIR = "skills";
export const CLAUDE_SKILL_NAME = "traffical";
export const CLAUDE_SKILL_FILENAME = "SKILL.md";

// Initialize AJV validator
const ajv = new Ajv({ allErrors: true, verbose: true });
const validateSchema = ajv.compile(configSchema);

/**
 * Validation error with detailed information
 */
export interface ValidationError {
  path: string;
  message: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Validate a config object against the JSON Schema.
 */
export function validateConfig(config: unknown): ValidationResult {
  const valid = validateSchema(config);

  if (valid) {
    return { valid: true, errors: [] };
  }

  const rawErrors = validateSchema.errors || [];
  
  // Filter out internal schema errors that are confusing to users
  // (like "must match 'then' schema" from conditional validation)
  const filteredErrors = rawErrors.filter((err) => {
    // Skip "if" keyword errors - these are internal to conditional validation
    if (err.keyword === "if") return false;
    // Skip generic "then" errors - the more specific type error will be shown
    if (err.keyword === "then") return false;
    // Skip oneOf errors - we'll provide cleaner messages for these
    if (err.keyword === "oneOf") return false;
    return true;
  });
  
  // Check for json type mismatches and provide a cleaner error
  // (When type is "json" but default is not object/array, we get multiple type errors)
  const jsonTypeMismatch = rawErrors.some(
    (err) => err.keyword === "oneOf" && err.instancePath?.endsWith("/default")
  );
  if (jsonTypeMismatch) {
    // Find the parameter path and add a cleaner error
    const oneOfError = rawErrors.find((err) => err.keyword === "oneOf");
    if (oneOfError) {
      const path = oneOfError.instancePath?.slice(1).replace(/\//g, ".") || "";
      // Check if there's already a type error for this path
      const hasTypeError = filteredErrors.some(
        (err) => err.instancePath === oneOfError.instancePath && err.keyword === "type"
      );
      if (!hasTypeError) {
        filteredErrors.push({
          keyword: "type",
          instancePath: oneOfError.instancePath || "",
          schemaPath: "",
          params: { type: "object or array (json)" },
          message: "must be object or array (json type)",
        } as typeof rawErrors[0]);
      }
    }
  }

  const errors: ValidationError[] = filteredErrors.map((err) => {
    // Build a human-readable path
    let path = err.instancePath || "/";
    if (path.startsWith("/")) {
      path = path.slice(1).replace(/\//g, ".");
    }
    if (!path) {
      path = "(root)";
    }

    // Build a human-readable message
    let message = err.message || "Unknown error";

    // Enhance messages for common error types
    if (err.keyword === "enum" && err.params?.allowedValues) {
      message = `must be one of: ${(err.params.allowedValues as string[]).join(", ")}`;
    } else if (err.keyword === "required" && err.params?.missingProperty) {
      message = `missing required property '${err.params.missingProperty}'`;
      if (path !== "(root)") {
        path = `${path}.${err.params.missingProperty}`;
      } else {
        path = err.params.missingProperty as string;
      }
    } else if (err.keyword === "additionalProperties" && err.params?.additionalProperty) {
      message = `unknown property '${err.params.additionalProperty}'`;
    } else if (err.keyword === "pattern") {
      message = `invalid format (${message})`;
    } else if (err.keyword === "type" && err.params?.type) {
      // Improve type mismatch messages
      const expectedType = err.params.type as string;
      message = `must be ${expectedType}`;
    }

    return { path, message };
  });

  // Deduplicate errors by path+message
  const uniqueErrors = errors.filter((err, index, self) =>
    index === self.findIndex((e) => e.path === err.path && e.message === err.message)
  );

  // Collapse "must be object" + "must be array" into a single "must be object or array" error
  const collapsedErrors: ValidationError[] = [];
  const processedPaths = new Set<string>();
  
  for (const err of uniqueErrors) {
    if (processedPaths.has(err.path)) continue;
    
    // Check if this path has both object and array type errors
    const hasObjectError = uniqueErrors.some(
      (e) => e.path === err.path && e.message === "must be object"
    );
    const hasArrayError = uniqueErrors.some(
      (e) => e.path === err.path && e.message === "must be array"
    );
    
    if (hasObjectError && hasArrayError) {
      // Collapse into single error
      collapsedErrors.push({
        path: err.path,
        message: "must be object or array (for json type)",
      });
      processedPaths.add(err.path);
    } else if (err.message !== "must be object" && err.message !== "must be array") {
      // Keep non-object/array errors as-is
      collapsedErrors.push(err);
      processedPaths.add(err.path);
    } else {
      // Single object or array error (not both) - keep it
      collapsedErrors.push(err);
      processedPaths.add(err.path);
    }
  }

  return { valid: false, errors: collapsedErrors };
}

/**
 * Format validation errors for display.
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  if (errors.length === 0) return "";

  const lines = ["", "Errors:"];
  for (const err of errors) {
    lines.push(`  - ${err.path}: ${err.message}`);
  }
  return lines.join("\n");
}

/**
 * Find Traffical config file in the current directory or parent directories.
 *
 * Search order (first match wins):
 * 1. .traffical/config.yaml (new default)
 * 2. traffical.yaml (legacy, for backwards compatibility)
 *
 * Walks up the directory tree until a config is found or root is reached.
 */
export async function findConfigFile(startDir: string = process.cwd()): Promise<string | null> {
  let currentDir = startDir;

  while (true) {
    // First check for new .traffical/config.yaml
    const newPath = join(currentDir, TRAFFICAL_DIR, CONFIG_FILENAME);
    try {
      await access(newPath);
      return newPath;
    } catch {
      // Not found, try legacy location
    }

    // Fallback: check for legacy traffical.yaml
    const legacyPath = join(currentDir, LEGACY_CONFIG_FILENAME);
    try {
      await access(legacyPath);
      return legacyPath;
    } catch {
      // Not found
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached root
      return null;
    }
    currentDir = parentDir;
  }
}

/**
 * Ensure the .traffical directory exists.
 *
 * @param baseDir - The base directory (defaults to cwd)
 * @returns The full path to the .traffical directory
 */
export async function ensureTrafficalDir(baseDir: string = process.cwd()): Promise<string> {
  const trafficalDir = join(baseDir, TRAFFICAL_DIR);
  await mkdir(trafficalDir, { recursive: true });
  return trafficalDir;
}

/**
 * Get the default config file path (.traffical/config.yaml).
 *
 * @param baseDir - The base directory (defaults to cwd)
 * @returns The full path to the config file
 */
export function getDefaultConfigPath(baseDir: string = process.cwd()): string {
  return join(baseDir, TRAFFICAL_DIR, CONFIG_FILENAME);
}

/**
 * Get the path to AGENTS.md file.
 * Note: AGENTS.md lives at the project root (for OpenAI Codex CLI compatibility),
 * not inside .traffical/
 *
 * @param baseDir - The base directory (defaults to cwd)
 * @returns The full path to AGENTS.md
 */
export function getAgentsPath(baseDir: string = process.cwd()): string {
  return join(baseDir, AGENTS_FILENAME);
}

/** Marker used to identify Traffical section in AGENTS.md */
export const TRAFFICAL_AGENTS_MARKER = "<!-- TRAFFICAL_INTEGRATION_START -->";
export const TRAFFICAL_AGENTS_MARKER_END = "<!-- TRAFFICAL_INTEGRATION_END -->";

/**
 * Check if AGENTS.md file exists.
 *
 * @param baseDir - The base directory (defaults to cwd)
 * @returns True if AGENTS.md exists
 */
export async function agentsFileExists(baseDir: string = process.cwd()): Promise<boolean> {
  try {
    await access(getAgentsPath(baseDir));
    return true;
  } catch {
    return false;
  }
}

/**
 * Read existing AGENTS.md content.
 *
 * @param baseDir - The base directory (defaults to cwd)
 * @returns The content of AGENTS.md, or null if it doesn't exist
 */
export async function readAgentsFile(baseDir: string = process.cwd()): Promise<string | null> {
  try {
    return await readFile(getAgentsPath(baseDir), "utf-8");
  } catch {
    return null;
  }
}

/**
 * Check if existing AGENTS.md already contains Traffical section.
 *
 * @param content - The content of AGENTS.md
 * @returns True if Traffical section exists
 */
export function hasTrafficalSection(content: string): boolean {
  return content.includes(TRAFFICAL_AGENTS_MARKER);
}

/**
 * Get the path to the TEMPLATES.md file.
 *
 * @param baseDir - The base directory (defaults to cwd)
 * @returns The full path to TEMPLATES.md
 */
export function getTemplatesPath(baseDir: string = process.cwd()): string {
  return join(baseDir, TRAFFICAL_DIR, TEMPLATES_FILENAME);
}

/**
 * Ensure the .claude/skills/traffical directory exists.
 *
 * @param baseDir - The base directory (defaults to cwd)
 * @returns The full path to the skill directory
 */
export async function ensureClaudeSkillDir(baseDir: string = process.cwd()): Promise<string> {
  const skillDir = join(baseDir, CLAUDE_DIR, CLAUDE_SKILLS_DIR, CLAUDE_SKILL_NAME);
  await mkdir(skillDir, { recursive: true });
  return skillDir;
}

/**
 * Get the path to the Claude Code Skill file.
 *
 * @param baseDir - The base directory (defaults to cwd)
 * @returns The full path to SKILL.md
 */
export function getClaudeSkillPath(baseDir: string = process.cwd()): string {
  return join(baseDir, CLAUDE_DIR, CLAUDE_SKILLS_DIR, CLAUDE_SKILL_NAME, CLAUDE_SKILL_FILENAME);
}

/**
 * Check if a config file is at the legacy location.
 */
export function isLegacyConfigPath(configPath: string): boolean {
  return configPath.endsWith(LEGACY_CONFIG_FILENAME);
}

/**
 * Read and parse a traffical.yaml file.
 * Validates against JSON Schema before returning.
 */
export async function readConfigFile(configPath: string): Promise<TrafficalConfig> {
  const content = await readFile(configPath, "utf-8");
  const parsed = parse(content);

  // Validate against JSON Schema
  const validation = validateConfig(parsed);
  if (!validation.valid) {
    const errorDetails = formatValidationErrors(validation.errors);
    throw new Error(`Invalid traffical.yaml at ${configPath}${errorDetails}`);
  }

  return parsed as TrafficalConfig;
}

/**
 * Options for writing config file with metadata
 */
export interface WriteConfigOptions {
  /** Include metadata comments (project name, org name, date) */
  metadata?: {
    projectName?: string;
    orgName?: string;
    createdAt?: string;
  };
  /** Include example section for empty configs */
  includeExample?: boolean;
}

/**
 * Generate the example section for empty config files.
 */
function generateExampleSection(): string {
  return `
# ──────────────────────────────────────────────────────────────────────────────
# Example parameter definitions:
#
#   checkout.button.color:
#     type: string
#     default: "#FF6600"
#     namespace: checkout
#     description: Primary CTA button background color
#
#   pricing.discount.enabled:
#     type: boolean
#     default: false
#     namespace: pricing
#
#   api.rate_limit:
#     type: number
#     default: 1000
#     description: Maximum requests per minute
#
#   ui.theme.config:
#     type: json
#     default:
#       primaryColor: "#FF6600"
#       borderRadius: 8
#
# Supported types: string, number, boolean, json
# Learn more: https://docs.traffical.io/config-as-code/parameters
# ──────────────────────────────────────────────────────────────────────────────
`;
}

/**
 * Write a traffical.yaml file.
 */
export async function writeConfigFile(
  configPath: string,
  config: TrafficalConfig,
  options: WriteConfigOptions = {}
): Promise<void> {
  const { metadata, includeExample } = options;

  // Build header with metadata
  let header = `# Traffical Configuration File\n`;

  if (metadata?.projectName) {
    header += `# Project: ${metadata.projectName} (${config.project.id})\n`;
  }
  if (metadata?.orgName) {
    header += `# Organization: ${metadata.orgName} (${config.project.orgId})\n`;
  }
  if (metadata?.createdAt) {
    header += `# Created: ${metadata.createdAt}\n`;
  }

  header += `#\n`;
  header += `# Parameters defined here are synced with Traffical.\n`;
  header += `# Base defaults become read-only in the dashboard.\n`;
  header += `# Learn more: https://docs.traffical.io/config-as-code\n`;
  header += `\n`;

  // Generate YAML content
  const content = stringify(config, {
    indent: 2,
    lineWidth: 0, // Don't wrap lines
  });

  // Add example section if requested and config has no parameters
  let footer = "";
  if (includeExample && Object.keys(config.parameters).length === 0) {
    footer = generateExampleSection();
  }

  await writeFile(configPath, header + content + footer, "utf-8");
}

/**
 * Options for creating a new config file
 */
export interface CreateConfigOptions {
  projectId: string;
  projectName: string;
  orgId: string;
  orgName: string;
  parameters?: Record<string, ConfigParameter>;
}

/**
 * Create a new traffical.yaml file.
 */
export async function createConfigFile(
  configPath: string,
  options: CreateConfigOptions
): Promise<TrafficalConfig> {
  const { projectId, projectName, orgId, orgName, parameters = {} } = options;

  const config: TrafficalConfig = {
    version: "1.0",
    project: {
      id: projectId,
      orgId: orgId,
    },
    parameters,
  };

  const createdAt = new Date().toISOString();

  await writeConfigFile(configPath, config, {
    metadata: {
      projectName,
      orgName,
      createdAt,
    },
    includeExample: Object.keys(parameters).length === 0,
  });

  return config;
}

/**
 * Add or update a parameter in a config file.
 */
export async function upsertParameter(
  configPath: string,
  key: string,
  param: ConfigParameter
): Promise<void> {
  const config = await readConfigFile(configPath);
  config.parameters[key] = param;
  await writeConfigFile(configPath, config);
}

/**
 * Remove a parameter from a config file.
 */
export async function removeParameter(configPath: string, key: string): Promise<boolean> {
  const config = await readConfigFile(configPath);
  if (key in config.parameters) {
    delete config.parameters[key];
    await writeConfigFile(configPath, config);
    return true;
  }
  return false;
}

/**
 * Convert API parameter to config format.
 */
export function apiParamToConfig(param: {
  key: string;
  type: ParameterType;
  defaultValue: ParameterValue;
  namespace?: string;
  description?: string;
}): { key: string; config: ConfigParameter } {
  const config: ConfigParameter = {
    type: param.type,
    default: param.defaultValue,
  };

  if (param.namespace && param.namespace !== "main") {
    config.namespace = param.namespace;
  }

  if (param.description) {
    config.description = param.description;
  }

  return { key: param.key, config };
}

/**
 * Convert config parameter to API sync format.
 */
export function configParamToApi(key: string, param: ConfigParameter) {
  return {
    key,
    type: param.type,
    default: param.default,
    namespace: param.namespace,
    description: param.description,
  };
}

/**
 * Convert API event definition to config format.
 */
export function apiEventToConfig(event: {
  name: string;
  valueType: EventValueType;
  unit?: string;
  description?: string;
}): { name: string; config: ConfigEvent } {
  const config: ConfigEvent = {
    valueType: event.valueType,
  };

  if (event.unit) {
    config.unit = event.unit;
  }

  if (event.description) {
    config.description = event.description;
  }

  return { name: event.name, config };
}

/**
 * Convert config event to API sync format.
 */
export function configEventToApi(name: string, event: ConfigEvent) {
  return {
    name,
    valueType: event.valueType,
    unit: event.unit,
    description: event.description,
  };
}

