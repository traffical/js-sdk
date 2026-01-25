#!/usr/bin/env bun
/**
 * Release script for @traffical/svelte
 *
 * Usage: bun run release [patch|minor|major]
 *
 * This script:
 * 1. Checks the current npm version to avoid conflicts
 * 2. Bumps the version in package.json
 * 3. Runs typecheck
 * 4. Builds the package
 * 5. Outputs next steps for committing and publishing
 */

import { $ } from "bun";

type BumpType = "patch" | "minor" | "major";

const VALID_BUMPS = ["patch", "minor", "major"];
const bumpArg = Bun.argv[2] || "patch";

if (!VALID_BUMPS.includes(bumpArg)) {
  console.error(`❌ Invalid bump type: ${bumpArg}`);
  console.error(`   Valid options: patch, minor, major`);
  process.exit(1);
}

const BUMP_TYPE = bumpArg as BumpType;

// Read package.json
const pkgPath = new URL("../package.json", import.meta.url).pathname;
const pkg = await Bun.file(pkgPath).json();
const localVersion: string = pkg.version;
const packageName: string = pkg.name;

console.log(`\n📦 ${packageName}`);
console.log(`   Local version: ${localVersion}`);

// =============================================================================
// Check npm registry for current published version
// =============================================================================

async function getNpmVersion(name: string): Promise<string | null> {
  try {
    const response = await fetch(`https://registry.npmjs.org/${name}/latest`);
    if (!response.ok) {
      if (response.status === 404) {
        return null; // Package not published yet
      }
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    return data.version;
  } catch (error) {
    console.warn(`   ⚠️  Could not fetch npm version: ${error}`);
    return null;
  }
}

function parseVersion(version: string): [number, number, number] {
  const [major, minor, patch] = version.split(".").map(Number);
  return [major, minor, patch];
}

function compareVersions(a: string, b: string): number {
  const [aMajor, aMinor, aPatch] = parseVersion(a);
  const [bMajor, bMinor, bPatch] = parseVersion(b);

  if (aMajor !== bMajor) return aMajor - bMajor;
  if (aMinor !== bMinor) return aMinor - bMinor;
  return aPatch - bPatch;
}

function bumpVersion(version: string, type: BumpType): string {
  const [major, minor, patch] = parseVersion(version);
  switch (type) {
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "major":
      return `${major + 1}.0.0`;
  }
}

const npmVersion = await getNpmVersion(packageName);

if (npmVersion) {
  console.log(`   npm version:   ${npmVersion}`);

  const comparison = compareVersions(localVersion, npmVersion);

  if (comparison < 0) {
    // Local is behind npm - this shouldn't happen normally
    console.error(`\n❌ Local version (${localVersion}) is behind npm (${npmVersion})`);
    console.error(`   Run: bun run release ${BUMP_TYPE} to bump from npm version`);

    // Auto-fix: bump from npm version instead
    const newVersion = bumpVersion(npmVersion, BUMP_TYPE);
    console.log(`\n🔧 Auto-fixing: bumping from npm version ${npmVersion} → ${newVersion}`);
    pkg.version = newVersion;
  } else if (comparison === 0) {
    // Local equals npm - need to bump
    const newVersion = bumpVersion(localVersion, BUMP_TYPE);
    console.log(`\n📝 Version ${localVersion} already on npm, bumping to ${newVersion}`);
    pkg.version = newVersion;
  } else {
    // Local is ahead of npm - already bumped, just validate
    console.log(`\n✓ Local version ${localVersion} is ahead of npm ${npmVersion}`);
    console.log(`  Proceeding with current version...`);
  }
} else {
  // Package not on npm yet - use local version or bump it
  console.log(`   npm version:   (not published yet)`);
  const newVersion = bumpVersion(localVersion, BUMP_TYPE);
  console.log(`\n📝 Bumping ${localVersion} → ${newVersion}`);
  pkg.version = newVersion;
}

const newVersion = pkg.version;

// =============================================================================
// Check workspace dependencies
// =============================================================================

const deps = pkg.dependencies || {};
const workspaceDeps = Object.entries(deps)
  .filter(([_, v]) => String(v).startsWith("workspace:"))
  .map(([name]) => name);

if (workspaceDeps.length > 0) {
  console.log(`\n⚠️  Workspace dependencies: ${workspaceDeps.join(", ")}`);
  console.log(`   Make sure these are published first!`);
}

// =============================================================================
// Write updated package.json
// =============================================================================

await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

console.log(`\n📦 ${packageName}: ${localVersion} → ${newVersion}\n`);

// =============================================================================
// Typecheck
// =============================================================================

console.log("🔍 Typechecking...");
try {
  await $`bun run typecheck`.quiet();
  console.log("   ✓ Typecheck passed");
} catch (error) {
  console.error("   ✗ Typecheck failed");
  // Revert version
  pkg.version = localVersion;
  await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  process.exit(1);
}

// =============================================================================
// Build
// =============================================================================

console.log("🔨 Building...");
try {
  await $`bun run build`.quiet();
  console.log("   ✓ Build succeeded");
} catch (error) {
  console.error("   ✗ Build failed");
  // Revert version
  pkg.version = localVersion;
  await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  process.exit(1);
}

// =============================================================================
// Success
// =============================================================================

const shortName = packageName.replace("@traffical/", "");

console.log(`
✅ Ready to release ${packageName}@${newVersion}

Next steps:
  1. Review changes:
     git diff

  2. Commit and push:
     git add -A
     git commit -m "chore(${shortName}): release v${newVersion}"
     git push

  3. CI will automatically:
     - Publish to npm
     - Create git tag ${packageName}@${newVersion}

Alternative (manual publish):
     cd packages/${shortName}
     npm publish --access public
`);
