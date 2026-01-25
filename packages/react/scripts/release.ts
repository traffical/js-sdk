#!/usr/bin/env bun
/**
 * Release script for @traffical/react
 * 
 * Usage: bun run release [patch|minor|major]
 * 
 * This script:
 * 1. Bumps the version in package.json
 * 2. Runs typecheck
 * 3. Builds the package
 * 4. Outputs next steps for committing and publishing
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
const oldVersion: string = pkg.version;

// Calculate new version
const [major, minor, patch] = oldVersion.split(".").map(Number);
const newVersion = {
  patch: `${major}.${minor}.${patch + 1}`,
  minor: `${major}.${minor + 1}.0`,
  major: `${major + 1}.0.0`,
}[BUMP_TYPE];

pkg.version = newVersion;

// Check workspace dependencies
const deps = pkg.dependencies || {};
const workspaceDeps = Object.entries(deps)
  .filter(([_, v]) => String(v).startsWith("workspace:"))
  .map(([name]) => name);

if (workspaceDeps.length > 0) {
  console.log(`⚠️  Workspace dependencies detected: ${workspaceDeps.join(", ")}`);
  console.log(`   Make sure these are published first!\n`);
}

// Write updated package.json
await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

console.log(`\n📦 ${pkg.name}: ${oldVersion} → ${newVersion}\n`);

// Typecheck
console.log("🔍 Typechecking...");
try {
  await $`bun run typecheck`.quiet();
  console.log("   ✓ Typecheck passed");
} catch (error) {
  console.error("   ✗ Typecheck failed");
  // Revert version
  pkg.version = oldVersion;
  await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  process.exit(1);
}

// Build
console.log("🔨 Building...");
try {
  await $`bun run build`.quiet();
  console.log("   ✓ Build succeeded");
} catch (error) {
  console.error("   ✗ Build failed");
  // Revert version
  pkg.version = oldVersion;
  await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  process.exit(1);
}

// Get short package name for git commands
const shortName = pkg.name.replace("@traffical/", "");

console.log(`
✅ Ready to release ${pkg.name}@${newVersion}

Next steps:
  1. Review changes:
     git diff

  2. Commit and tag:
     git add -A
     git commit -m "chore(${shortName}): release v${newVersion}"
     git tag ${pkg.name}@${newVersion}

  3. Push:
     git push && git push --tags

  4. Publish to npm:
     cd sdk/${shortName}
     npm publish --access public
`);

