/**
 * Portable loader for @traffical/sdk-spec conformance fixtures.
 *
 * Mirrors packages/core/src/resolution/spec-fixtures.ts so the OpenFeature
 * conformance tests stop hard-coding the fragile `../../../../sdk-spec` sibling
 * path (which broke CI when the checkout layout differed). Fixtures are resolved
 * from the first available source, in order:
 *
 *   1. The installed `@traffical/sdk-spec` package — but ONLY when it is already
 *      at >= 0.7.0 (so a stale pin never shadows a changed 0.7.0 fixture).
 *   2. The local sibling `sdk-spec` checkout (dev + local CI), found by walking
 *      up from this file.
 *   3. The installed package's fixtures as a last resort (unchanged files).
 *
 * TODO(release): once @traffical/sdk-spec 0.7.0 is published and pinned, source
 * (1) always wins and the sibling-repo fallback (2) can be deleted.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const MIN_SPEC_VERSION = [0, 7, 0] as const;

function parseSemver(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function gte(a: [number, number, number], b: readonly [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true;
}

let cachedRoots: string[] | null = null;

function fixtureRoots(): string[] {
  if (cachedRoots) return cachedRoots;

  const roots: string[] = [];
  const require = createRequire(import.meta.url);

  let packageRoot: string | null = null;
  let packageIsCurrent = false;
  try {
    const pkgJsonPath = require.resolve("@traffical/sdk-spec/package.json");
    packageRoot = dirname(pkgJsonPath);
    const version = parseSemver(
      JSON.parse(readFileSync(pkgJsonPath, "utf8")).version ?? ""
    );
    packageIsCurrent = version !== null && gte(version, MIN_SPEC_VERSION);
  } catch {
    // package not resolvable — rely on the sibling checkout below.
  }

  const pkgFixtures = packageRoot
    ? join(packageRoot, "test-vectors", "fixtures")
    : null;

  // (1) current published package wins outright.
  if (packageIsCurrent && pkgFixtures) roots.push(pkgFixtures);

  // (2) local sibling `sdk-spec` checkout (drift-remediation branch).
  let dir = fileURLToPath(new URL(".", import.meta.url));
  for (let i = 0; i < 10; i++) {
    roots.push(join(dir, "sdk-spec", "test-vectors", "fixtures"));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // (3) stale package as last resort (unchanged files only).
  if (!packageIsCurrent && pkgFixtures) roots.push(pkgFixtures);

  cachedRoots = roots;
  return cachedRoots;
}

/**
 * Loads and parses a spec fixture by file name (WITH extension), e.g.
 * `loadFixture<ConfigBundle>("bundle_basic.json")`.
 *
 * @throws if the fixture is not found in any candidate root — a missing
 *   conformance fixture must fail the run, not silently skip coverage.
 */
export function loadFixture<T = unknown>(fileName: string): T {
  for (const root of fixtureRoots()) {
    const candidate = join(root, fileName);
    if (existsSync(candidate)) {
      return JSON.parse(readFileSync(candidate, "utf8")) as T;
    }
  }
  throw new Error(
    `[traffical] spec fixture "${fileName}" not found. Searched:\n` +
      fixtureRoots().map((r) => `  - ${r}`).join("\n") +
      `\nEnsure @traffical/sdk-spec >= 0.7.0 is installed or the sibling ` +
      `sdk-spec checkout is present.`
  );
}
