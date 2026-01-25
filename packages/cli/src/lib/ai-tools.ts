/**
 * AI Tool Integration
 *
 * Detects and updates AI coding tool configuration files
 * (CLAUDE.md, .cursorrules, etc.) to reference Traffical.
 */

import { access, readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";

export interface AIToolFile {
  /** Display name of the file */
  filename: string;
  /** Name of the AI tool */
  tool: string;
  /** Path relative to project root */
  relativePath: string;
  /** Whether this is a markdown file */
  isMarkdown: boolean;
}

/**
 * List of known AI coding tool configuration files.
 */
export const AI_TOOL_FILES: AIToolFile[] = [
  {
    filename: "CLAUDE.md",
    tool: "Claude Code",
    relativePath: "CLAUDE.md",
    isMarkdown: true,
  },
  {
    filename: ".cursorrules",
    tool: "Cursor",
    relativePath: ".cursorrules",
    isMarkdown: true,
  },
  {
    filename: "copilot-instructions.md",
    tool: "GitHub Copilot",
    relativePath: ".github/copilot-instructions.md",
    isMarkdown: true,
  },
  {
    filename: ".windsurfrules",
    tool: "Windsurf",
    relativePath: ".windsurfrules",
    isMarkdown: true,
  },
  {
    filename: "AGENTS.md",
    tool: "Generic",
    relativePath: "AGENTS.md",
    isMarkdown: true,
  },
];

export interface DetectedAITool {
  file: AIToolFile;
  /** Whether the file exists */
  exists: boolean;
  /** Whether the file already mentions Traffical */
  hasTrafficalReference: boolean;
  /** Full path to the file */
  path: string;
}

/**
 * Check if a file exists.
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect AI tool configuration files in a project directory.
 *
 * @param projectDir - The project root directory
 * @returns Array of detected AI tool files with their status
 */
export async function detectAIToolFiles(
  projectDir: string
): Promise<DetectedAITool[]> {
  const results: DetectedAITool[] = [];

  for (const file of AI_TOOL_FILES) {
    const fullPath = join(projectDir, file.relativePath);
    let exists = false;
    let hasTrafficalReference = false;

    try {
      const content = await readFile(fullPath, "utf-8");
      exists = true;
      // Check if file already mentions Traffical (case-insensitive)
      hasTrafficalReference = content.toLowerCase().includes("traffical");
    } catch {
      // File doesn't exist
    }

    results.push({
      file,
      exists,
      hasTrafficalReference,
      path: fullPath,
    });
  }

  return results;
}

/**
 * Generate the Traffical section to add to AI tool config files.
 */
export function generateTrafficalSection(): string {
  return `
## Experimentation & Feature Flags

This project uses **Traffical** for feature flags and A/B testing.

When implementing new features or modifying existing behavior:
1. Check \`.traffical/config.yaml\` for existing parameters
2. Consider if the change should be behind a feature flag
3. For UI changes affecting conversion, suggest an A/B test
4. Use code patterns from \`.traffical/TEMPLATES.md\`

See \`.traffical/AGENTS.md\` for complete integration guide.
`;
}

/**
 * Add Traffical reference to an AI tool configuration file.
 *
 * @param tool - The detected AI tool file info
 */
export async function addTrafficalReference(
  tool: DetectedAITool
): Promise<void> {
  const section = generateTrafficalSection();

  if (tool.exists) {
    // Append to existing file
    const content = await readFile(tool.path, "utf-8");
    const newContent = content.trimEnd() + "\n" + section;
    await writeFile(tool.path, newContent, "utf-8");
  } else {
    // Create new file with the Traffical section
    await mkdir(dirname(tool.path), { recursive: true });
    await writeFile(tool.path, section.trim() + "\n", "utf-8");
  }
}

/**
 * Get AI tool files that can be updated (exist but don't have Traffical reference).
 */
export function getUpdatableTools(tools: DetectedAITool[]): DetectedAITool[] {
  return tools.filter((t) => t.exists && !t.hasTrafficalReference);
}

/**
 * Get AI tool files that already have Traffical reference.
 */
export function getAlreadyIntegratedTools(
  tools: DetectedAITool[]
): DetectedAITool[] {
  return tools.filter((t) => t.exists && t.hasTrafficalReference);
}

/**
 * Check if any AI tool files exist in the project.
 */
export function hasAnyAIToolFiles(tools: DetectedAITool[]): boolean {
  return tools.some((t) => t.exists);
}


