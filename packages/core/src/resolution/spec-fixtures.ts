/**
 * Portable loader for @traffical/sdk-spec conformance fixtures.
 *
 * The 0.7.0 drift-remediation fixtures (empty/numeric unit keys, exposure
 * shape, omitted conditions, contextual boundary/guards, unicode, …) are
 * consumed here BEFORE `@traffical/sdk-spec@0.7.0` is published. To keep local
 * CI green against the in-flight spec branch without pinning an unpublished npm
 * version, `loadSpecFixture()` resolves each fixture from the first available
 * source, in order:
 *
 *   1. The installed `@traffical/sdk-spec` package — but ONLY when it is already
 *      at >= 0.7.0 (so a stale 0.5.0 pin never shadows a changed fixture).
 *   2. The local sibling `sdk-spec` checkout on the drift-remediation branch
 *      (dev + local CI), discovered by walking up from this file.
 *   3. The installed package's fixtures dir as a last resort (older fixtures
 *      that did not change in 0.7.0).
 *
 * TODO(release): once @traffical/sdk-spec 0.7.0 is published and pinned in the
 * package.json devDependencies, candidate (1) always wins and the sibling-repo
 * fallback (2) can be deleted — switch the conformance tests back to plain
 * `import { ... } from "@traffical/sdk-spec"`.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

/** Minimum spec version whose published fixtures match this SDK's expectations. */
const MIN_SPEC_VERSION = [0, 7, 0] as const;

function parseSemverMajorMinorPatch(v: string): [number, number, number] | null {
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

let cachedRoots: { fixtures: string[]; schemas: string[] } | null = null;

function specRoots(): { fixtures: string[]; schemas: string[] } {
  if (cachedRoots) return cachedRoots;

  const fixtures: string[] = [];
  const schemas: string[] = [];
  const require = createRequire(import.meta.url);

  let packageRoot: string | null = null;
  let packageIsCurrent = false;
  try {
    const pkgJsonPath = require.resolve("@traffical/sdk-spec/package.json");
    packageRoot = dirname(pkgJsonPath);
    const version = parseSemverMajorMinorPatch(
      JSON.parse(readFileSync(pkgJsonPath, "utf8")).version ?? ""
    );
    packageIsCurrent = version !== null && gte(version, MIN_SPEC_VERSION);
  } catch {
    // package not resolvable — rely on the local sibling checkout below.
  }

  const pkgFixtures = packageRoot ? join(packageRoot, "test-vectors", "fixtures") : null;
  const pkgSchemas = packageRoot ? join(packageRoot, "schemas") : null;

  // (1) current published package wins outright.
  if (packageIsCurrent && pkgFixtures) fixtures.push(pkgFixtures);
  if (packageIsCurrent && pkgSchemas) schemas.push(pkgSchemas);

  // (2) local sibling `sdk-spec` checkout (drift-remediation branch).
  let dir = fileURLToPath(new URL(".", import.meta.url));
  for (let i = 0; i < 10; i++) {
    fixtures.push(join(dir, "sdk-spec", "test-vectors", "fixtures"));
    schemas.push(join(dir, "sdk-spec", "schemas"));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // (3) stale package as last resort (unchanged files only).
  if (!packageIsCurrent && pkgFixtures) fixtures.push(pkgFixtures);
  if (!packageIsCurrent && pkgSchemas) schemas.push(pkgSchemas);

  cachedRoots = { fixtures, schemas };
  return cachedRoots;
}

function fixtureRoots(): string[] {
  return specRoots().fixtures;
}

/**
 * Loads and parses a spec fixture JSON by base name (without extension),
 * e.g. `loadSpecFixture("bundle_empty_unit_key")`.
 *
 * @throws if the fixture cannot be found in any candidate root — a hard error
 *   is correct here: a missing conformance fixture must fail the test run
 *   rather than silently skip coverage.
 */
export function loadSpecFixture<T = unknown>(name: string): T {
  const file = `${name}.json`;
  for (const root of fixtureRoots()) {
    const candidate = join(root, file);
    if (existsSync(candidate)) {
      return JSON.parse(readFileSync(candidate, "utf8")) as T;
    }
  }
  throw new Error(
    `[traffical] spec fixture "${file}" not found. Searched:\n` +
      fixtureRoots().map((r) => `  - ${r}`).join("\n") +
      `\nEnsure @traffical/sdk-spec >= 0.7.0 is installed or the sibling sdk-spec ` +
      `checkout is on the drift-remediation branch.`
  );
}

/**
 * Loads and parses a spec JSON Schema by base name (without extension),
 * e.g. `loadSpecSchema("events.schema")`.
 */
export function loadSpecSchema<T = unknown>(name: string): T {
  const file = `${name}.json`;
  for (const root of specRoots().schemas) {
    const candidate = join(root, file);
    if (existsSync(candidate)) {
      return JSON.parse(readFileSync(candidate, "utf8")) as T;
    }
  }
  throw new Error(
    `[traffical] spec schema "${file}" not found. Searched:\n` +
      specRoots().schemas.map((r) => `  - ${r}`).join("\n")
  );
}
