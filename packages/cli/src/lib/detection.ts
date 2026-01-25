/**
 * Framework Detection
 *
 * Detects the language and framework of a project by analyzing
 * configuration files and package.json dependencies.
 */

import { access, readFile } from "fs/promises";
import { join } from "path";

export type Language = "typescript" | "javascript";
export type Framework =
  | "react"
  | "nextjs"
  | "svelte"
  | "sveltekit"
  | "vue"
  | "nuxt"
  | "node"
  | "express"
  | "fastify"
  | "hono"
  | "unknown";

export type Confidence = "high" | "medium" | "low";

export interface DetectedStack {
  language: Language;
  framework: Framework;
  confidence: Confidence;
  signals: string[];
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
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
 * Read and parse package.json from a directory.
 */
async function readPackageJson(dir: string): Promise<PackageJson | null> {
  try {
    const content = await readFile(join(dir, "package.json"), "utf-8");
    return JSON.parse(content) as PackageJson;
  } catch {
    return null;
  }
}

/**
 * Check if a package is in dependencies or devDependencies.
 */
function hasDependency(pkg: PackageJson | null, name: string): boolean {
  if (!pkg) return false;
  return !!(pkg.dependencies?.[name] || pkg.devDependencies?.[name]);
}

/**
 * Detect if the project uses TypeScript.
 */
async function detectLanguage(dir: string): Promise<Language> {
  if (await fileExists(join(dir, "tsconfig.json"))) {
    return "typescript";
  }
  return "javascript";
}

/**
 * Detect the framework used in a project.
 *
 * Detection priority (first match wins):
 * 1. SvelteKit (svelte.config.js + @sveltejs/kit)
 * 2. Svelte (svelte.config.js without kit)
 * 3. Nuxt (nuxt.config.ts/js or @nuxt/core)
 * 4. Next.js (next.config.js/ts or next in deps)
 * 5. Vue (vue in deps, not nuxt)
 * 6. React (react in deps)
 * 7. Node.js (fallback for JS/TS projects)
 * 8. Unknown
 */
export async function detectFramework(projectDir: string): Promise<DetectedStack> {
  const signals: string[] = [];
  const pkg = await readPackageJson(projectDir);
  
  // Detect language first
  const language = await detectLanguage(projectDir);
  if (language === "typescript") {
    signals.push("tsconfig.json found");
  }

  // Check for SvelteKit
  const hasSvelteConfig =
    (await fileExists(join(projectDir, "svelte.config.js"))) ||
    (await fileExists(join(projectDir, "svelte.config.ts")));
  const hasSvelteKit = hasDependency(pkg, "@sveltejs/kit");

  if (hasSvelteConfig && hasSvelteKit) {
    signals.push("svelte.config.js found", "@sveltejs/kit in dependencies");
    return {
      language,
      framework: "sveltekit",
      confidence: "high",
      signals,
    };
  }

  // Check for Svelte (without Kit)
  if (hasSvelteConfig || hasDependency(pkg, "svelte")) {
    if (hasSvelteConfig) signals.push("svelte.config.js found");
    if (hasDependency(pkg, "svelte")) signals.push("svelte in dependencies");
    return {
      language,
      framework: "svelte",
      confidence: "high",
      signals,
    };
  }

  // Check for Nuxt
  const hasNuxtConfig =
    (await fileExists(join(projectDir, "nuxt.config.ts"))) ||
    (await fileExists(join(projectDir, "nuxt.config.js")));
  const hasNuxt = hasDependency(pkg, "nuxt") || hasDependency(pkg, "@nuxt/core");

  if (hasNuxtConfig || hasNuxt) {
    if (hasNuxtConfig) signals.push("nuxt.config found");
    if (hasNuxt) signals.push("nuxt in dependencies");
    return {
      language,
      framework: "nuxt",
      confidence: "high",
      signals,
    };
  }

  // Check for Next.js
  const hasNextConfig =
    (await fileExists(join(projectDir, "next.config.js"))) ||
    (await fileExists(join(projectDir, "next.config.ts"))) ||
    (await fileExists(join(projectDir, "next.config.mjs")));
  const hasNext = hasDependency(pkg, "next");

  if (hasNextConfig || hasNext) {
    if (hasNextConfig) signals.push("next.config found");
    if (hasNext) signals.push("next in dependencies");
    return {
      language,
      framework: "nextjs",
      confidence: "high",
      signals,
    };
  }

  // Check for Vue (but not Nuxt, which was already checked)
  if (hasDependency(pkg, "vue")) {
    signals.push("vue in dependencies");
    return {
      language,
      framework: "vue",
      confidence: "medium",
      signals,
    };
  }

  // Check for React
  if (hasDependency(pkg, "react")) {
    signals.push("react in dependencies");
    return {
      language,
      framework: "react",
      confidence: "medium",
      signals,
    };
  }

  // If we have a package.json, assume Node.js backend
  if (pkg) {
    signals.push("package.json found");
    return {
      language,
      framework: "node",
      confidence: "low",
      signals,
    };
  }

  // No detection
  return {
    language,
    framework: "unknown",
    confidence: "low",
    signals,
  };
}

/**
 * Get a human-readable name for a framework.
 */
export function getFrameworkDisplayName(framework: Framework): string {
  const names: Record<Framework, string> = {
    react: "React",
    nextjs: "Next.js",
    svelte: "Svelte",
    sveltekit: "SvelteKit",
    vue: "Vue",
    nuxt: "Nuxt",
    node: "Node.js",
    express: "Express",
    fastify: "Fastify",
    hono: "Hono",
    unknown: "Unknown",
  };
  return names[framework];
}

/**
 * Get the SDK package name for a framework.
 */
export function getSdkPackage(framework: Framework): string {
  switch (framework) {
    case "react":
    case "nextjs":
      return "@traffical/react";
    case "svelte":
    case "sveltekit":
      return "@traffical/svelte";
    case "vue":
    case "nuxt":
      return "@traffical/vue";
    case "node":
    default:
      return "@traffical/node";
  }
}

/**
 * Check if a framework is a full-stack framework (has both client and server contexts).
 */
export function isFullStackFramework(framework: Framework): boolean {
  return ["nextjs", "sveltekit", "nuxt"].includes(framework);
}

/**
 * List of all supported frameworks for selection prompts.
 */
export const SUPPORTED_FRAMEWORKS: Array<{ value: Framework; name: string }> = [
  { value: "react", name: "React" },
  { value: "nextjs", name: "Next.js" },
  { value: "svelte", name: "Svelte" },
  { value: "sveltekit", name: "SvelteKit" },
  { value: "vue", name: "Vue" },
  { value: "nuxt", name: "Nuxt" },
  { value: "node", name: "Node.js (Backend)" },
];

