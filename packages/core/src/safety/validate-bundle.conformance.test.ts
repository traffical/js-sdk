/**
 * Conformance: the deep bundle validator must accept every bundle the
 * published spec fixtures declare valid.
 *
 * The validator is hand-rolled, so its only real failure mode is drifting from
 * `sdk-spec/schemas/config-bundle.schema.json` — a validator that is too strict
 * rejects legitimate config and takes the SDK offline, which is strictly worse
 * than the crash it was written to prevent. This test is the guard.
 *
 * It earned its place immediately: the first draft required `conditions[].operator`
 * where the spec says `op`, which rejected every bundle using a targeting
 * condition. Two fixtures caught it.
 */

import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { validateConfigBundle } from "./validate-bundle.ts";

/** Resolve the sibling sdk-spec checkout, or the installed package. */
function fixtureDir(): string | null {
  const candidates = [
    join(dirname(new URL(import.meta.url).pathname), "../../../../sdk-spec/test-vectors/fixtures"),
    join(process.cwd(), "../../../sdk-spec/test-vectors/fixtures"),
    join(process.cwd(), "node_modules/@traffical/sdk-spec/test-vectors/fixtures"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

const dir = fixtureDir();

describe("validateConfigBundle — spec fixture conformance", () => {
  test("every published bundle fixture is accepted", () => {
    if (!dir) {
      // Don't fail the suite in a checkout without the spec sibling; the CI
      // spec-pin check covers presence.
      console.warn("[skip] sdk-spec fixtures not found");
      return;
    }

    const fixtures = readdirSync(dir).filter((n) => n.startsWith("bundle_") && n.endsWith(".json"));
    expect(fixtures.length).toBeGreaterThan(0);

    const rejected: string[] = [];
    for (const name of fixtures) {
      const bundle: unknown = JSON.parse(readFileSync(join(dir, name), "utf8"));
      const result = validateConfigBundle(bundle);
      if (!result.ok) rejected.push(`${name} → ${result.path}: ${result.reason}`);
    }

    expect(rejected).toEqual([]);
  });

  test("the fixture set covers conditions, contextual, and per-layer unit keys", () => {
    if (!dir) return;
    const names = readdirSync(dir);
    // If these stop existing the test above silently weakens.
    expect(names).toContain("bundle_conditions.json");
    expect(names).toContain("bundle_contextual.json");
    expect(names).toContain("bundle_per_layer_unit_key.json");
  });
});
