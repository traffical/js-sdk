/**
 * Authentication Management
 *
 * Handles API key storage and retrieval.
 * Priority order for credentials:
 * 1. Command-line flags (--api-key, --api-base)
 * 2. Environment variables (TRAFFICAL_API_KEY, TRAFFICAL_API_BASE)
 * 3. Profile from ~/.trafficalrc
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { homedir } from "os";
import { join, dirname } from "path";
import { parse, stringify } from "yaml";
import type { TrafficalRc, ProfileConfig } from "./types.ts";

const RC_FILENAME = ".trafficalrc";

/** Environment variable names */
export const ENV_API_KEY = "TRAFFICAL_API_KEY";
export const ENV_API_BASE = "TRAFFICAL_API_BASE";

/**
 * Get the path to ~/.trafficalrc
 */
export function getRcPath(): string {
  return join(homedir(), RC_FILENAME);
}

/**
 * Read the ~/.trafficalrc file.
 * Returns default config if file doesn't exist.
 */
export async function readRcFile(): Promise<TrafficalRc> {
  const rcPath = getRcPath();

  try {
    const content = await readFile(rcPath, "utf-8");
    const parsed = parse(content) as TrafficalRc;
    return {
      default_profile: parsed.default_profile,
      profiles: parsed.profiles || {},
    };
  } catch {
    // File doesn't exist or is invalid
    return { profiles: {} };
  }
}

/**
 * Write the ~/.trafficalrc file.
 */
export async function writeRcFile(rc: TrafficalRc): Promise<void> {
  const rcPath = getRcPath();

  // Ensure directory exists
  await mkdir(dirname(rcPath), { recursive: true });

  const header = `# Traffical CLI configuration
# API keys are stored here for authentication
# Do not commit this file to version control!

`;

  const content = stringify(rc, { indent: 2 });
  await writeFile(rcPath, header + content, "utf-8");
}

/**
 * Get a profile configuration.
 * Uses default_profile if no profile specified.
 */
export async function getProfile(profileName?: string): Promise<ProfileConfig | null> {
  const rc = await readRcFile();
  const name = profileName || rc.default_profile;

  if (!name) {
    return null;
  }

  return rc.profiles[name] || null;
}

/**
 * Set a profile configuration.
 */
export async function setProfile(name: string, config: ProfileConfig): Promise<void> {
  const rc = await readRcFile();
  rc.profiles[name] = config;

  // Set as default if no default exists
  if (!rc.default_profile) {
    rc.default_profile = name;
  }

  await writeRcFile(rc);
}

/**
 * Set the default profile.
 */
export async function setDefaultProfile(name: string): Promise<void> {
  const rc = await readRcFile();

  if (!rc.profiles[name]) {
    throw new Error(`Profile "${name}" does not exist`);
  }

  rc.default_profile = name;
  await writeRcFile(rc);
}

/**
 * List all profiles.
 */
export async function listProfiles(): Promise<{ name: string; isDefault: boolean }[]> {
  const rc = await readRcFile();
  return Object.keys(rc.profiles).map((name) => ({
    name,
    isDefault: name === rc.default_profile,
  }));
}

/**
 * Delete a profile.
 */
export async function deleteProfile(name: string): Promise<boolean> {
  const rc = await readRcFile();

  if (!rc.profiles[name]) {
    return false;
  }

  delete rc.profiles[name];

  // Clear default if it was the deleted profile
  if (rc.default_profile === name) {
    const remaining = Object.keys(rc.profiles);
    rc.default_profile = remaining[0] || undefined;
  }

  await writeRcFile(rc);
  return true;
}

/**
 * Get API key.
 * Priority: apiKeyOverride > TRAFFICAL_API_KEY env var > profile
 */
export async function getApiKey(profileName?: string, apiKeyOverride?: string): Promise<string> {
  // 1. Command-line override
  if (apiKeyOverride) {
    return apiKeyOverride;
  }

  // 2. Environment variable
  const envKey = process.env[ENV_API_KEY];
  if (envKey) {
    return envKey;
  }

  // 3. Profile from ~/.trafficalrc
  const profile = await getProfile(profileName);
  if (profile?.api_key) {
    return profile.api_key;
  }

  throw new Error(
    `No API key found. Provide one via:\n` +
    `  --api-key flag\n` +
    `  ${ENV_API_KEY} environment variable\n` +
    `  'traffical init' to save to ~/.trafficalrc`
  );
}

/**
 * Get API base URL.
 * Priority: apiBaseOverride > TRAFFICAL_API_BASE env var > profile > default
 */
export async function getApiBase(profileName?: string, apiBaseOverride?: string): Promise<string> {
  // 1. Command-line override
  if (apiBaseOverride) {
    return apiBaseOverride;
  }

  // 2. Environment variable
  const envBase = process.env[ENV_API_BASE];
  if (envBase) {
    return envBase;
  }

  // 3. Profile from ~/.trafficalrc
  const profile = await getProfile(profileName);
  if (profile?.api_base) {
    return profile.api_base;
  }

  // 4. Default
  return "https://api.traffical.io";
}

