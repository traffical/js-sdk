/**
 * Stale-pin gate.
 *
 * Fails CI when a package's pinned `@traffical/sdk-spec` dependency is BEHIND
 * the latest published spec version — i.e. a newer spec has shipped but this
 * repo still pins an older one. This is the guardrail that keeps a
 * published-pin bump from being missed after a spec release.
 *
 * "Latest" is the PUBLISHED version from `npm view @traffical/sdk-spec version`.
 * The unpublished sibling checkout is deliberately NOT used as "latest" — it is
 * the in-flight spec, and treating it as published would fire the gate
 * prematurely. If npm is unreachable (offline), the check is SKIPPED with a
 * warning rather than failing — it must never block CI on an inability to look
 * up the latest version.
 *
 * Run: `bun run scripts/check-spec-pin.ts`
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const SPEC = "@traffical/sdk-spec";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

type Semver = [number, number, number];

function parse(v: string): Semver | null {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function cmp(a: Semver, b: Semver): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** True if `latest` is newer than the highest version the pin range allows. */
function isBehind(range: string, latest: Semver): boolean {
  const floor = parse(range);
  if (!floor) return false; // unparseable (workspace:*, file:, tag) — ignore
  if (cmp(latest, floor) <= 0) return false; // pin is at/ahead of latest
  const [fa, fb] = floor;
  const op = range.trim()[0];
  if (op === "^") {
    // Caret upper bound: next left-most non-zero segment.
    if (fa > 0) return latest[0] > fa; // ^a.b.c allows [a.b.c, (a+1).0.0)
    if (fb > 0) return latest[0] > 0 || latest[1] > fb; // ^0.b.c allows 0.b.x
    return true; // ^0.0.c allows only 0.0.c; any newer is behind
  }
  if (op === "~") {
    // ~a.b.c allows patches within a.b.
    return latest[0] > fa || latest[1] > fb;
  }
  if (op === ">" || op === "*" || range.includes("x")) return false; // permissive
  return true; // exact pin, latest is strictly newer
}

function latestPublished(): Semver | null {
  try {
    const out = execSync(`npm view ${SPEC} version`, {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 20_000,
    })
      .toString()
      .trim();
    return parse(out);
  } catch {
    return null; // offline / not yet published — caller skips.
  }
}

function collectPins(): Array<{ pkg: string; range: string }> {
  const pins: Array<{ pkg: string; range: string }> = [];
  const pkgsDir = join(repoRoot, "packages");
  for (const name of readdirSync(pkgsDir)) {
    const pj = join(pkgsDir, name, "package.json");
    if (!existsSync(pj)) continue;
    const json = JSON.parse(readFileSync(pj, "utf8"));
    const range =
      json.dependencies?.[SPEC] ??
      json.devDependencies?.[SPEC] ??
      json.peerDependencies?.[SPEC];
    if (typeof range === "string") pins.push({ pkg: json.name ?? name, range });
  }
  return pins;
}

const latest = latestPublished();
if (!latest) {
  console.warn(
    `[check-spec-pin] Could not determine the latest ${SPEC} version (offline and no sibling checkout). Skipping stale-pin gate.`
  );
  process.exit(0);
}

const pins = collectPins();
const stale = pins.filter((p) => isBehind(p.range, latest));

if (stale.length > 0) {
  const latestStr = latest.join(".");
  console.error(
    `[check-spec-pin] ${SPEC} ${latestStr} is published, but these packages pin an older spec:\n` +
      stale.map((p) => `  - ${p.pkg}: "${p.range}"`).join("\n") +
      `\nBump the pin to ^${latestStr} (and drop the local sibling-checkout fallback in the conformance tests).`
  );
  process.exit(1);
}

console.log(
  `[check-spec-pin] OK — all ${SPEC} pins satisfy the latest published version ${latest.join(".")}.`
);
