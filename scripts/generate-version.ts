/**
 * Reads the current package's package.json and writes src/version.ts
 * so the SDK version is always in sync with the published version.
 *
 * Run from any package directory:
 *   bun run ../../scripts/generate-version.ts
 */
import { readFileSync, writeFileSync } from "fs";

const pkg = JSON.parse(readFileSync("package.json", "utf-8"));

writeFileSync(
  "src/version.ts",
  `// Auto-generated from package.json — do not edit manually.\nexport const SDK_VERSION = "${pkg.version}";\n`,
);
