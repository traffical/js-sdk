/**
 * Deep structural validation for a config bundle.
 *
 * A 200 response can still carry a malformed body (truncated CDN write,
 * partial deploy), and a hand-assembled `localConfig` can be malformed in
 * exactly the same ways. Serving either would corrupt bucket assignment, and
 * the resolver walks nested arrays unconditionally — so a bundle whose
 * `layers[].policies` is missing throws out of `decide()` into the host.
 *
 * Two rules this encodes:
 *
 *  - **Validate at every ingestion point.** Both the fetched bundle and
 *    `localConfig` pass through here. Previously only the fetched one did,
 *    which meant the bundle arriving over TLS from our own edge was checked
 *    and the one a customer hand-edits was not.
 *  - **Reject whole, never partially apply.** A bundle that half-parses
 *    produces silently wrong buckets, which is worse than serving last-good.
 *    There is no coercion here and no repair: the answer is yes or no.
 *
 * The checks mirror `sdk-spec/schemas/config-bundle.schema.json` for every
 * field the resolver actually dereferences. `validate-bundle.conformance.test.ts`
 * asserts the two agree across the published fixtures so they cannot drift.
 */

import type { ConfigBundle } from "../types/index.js";

/** Why a bundle was rejected. `path` is a dotted pointer to the offending node. */
export interface BundleValidationFailure {
  ok: false;
  /** Dotted path to the offending node, e.g. `layers[2].policies[0].allocations`. */
  path: string;
  /** Human-readable reason, safe to log. Never contains bundle values. */
  reason: string;
}

export interface BundleValidationSuccess {
  ok: true;
}

export type BundleValidationResult = BundleValidationSuccess | BundleValidationFailure;

function fail(path: string, reason: string): BundleValidationFailure {
  return { ok: false, path, reason };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/**
 * Validates the structure the resolver depends on.
 *
 * Deliberately NOT validated: parameter `default` values and allocation
 * `overrides` values (any JSON value is legal by design), `conditions[].value`
 * (same), and any field the resolver only ever reads optionally. Adding checks
 * there would reject bundles that resolve correctly.
 */
export function validateConfigBundle(bundle: unknown): BundleValidationResult {
  if (!isObject(bundle)) return fail("", "bundle is not an object");

  // --- hashing: drives every bucket computation --------------------------
  const hashing = bundle.hashing;
  if (!isObject(hashing)) return fail("hashing", "missing or not an object");
  if (!isNonEmptyString(hashing.unitKey)) {
    return fail("hashing.unitKey", "missing or not a non-empty string");
  }
  if (
    typeof hashing.bucketCount !== "number" ||
    !Number.isInteger(hashing.bucketCount) ||
    hashing.bucketCount < 1
  ) {
    return fail("hashing.bucketCount", "not an integer >= 1");
  }

  // --- parameters --------------------------------------------------------
  if (!Array.isArray(bundle.parameters)) return fail("parameters", "not an array");
  for (let i = 0; i < bundle.parameters.length; i++) {
    const p: unknown = bundle.parameters[i];
    const at = `parameters[${i}]`;
    if (!isObject(p)) return fail(at, "not an object");
    if (!isNonEmptyString(p.key)) return fail(`${at}.key`, "missing or not a non-empty string");
    if (!isNonEmptyString(p.layerId)) {
      return fail(`${at}.layerId`, "missing or not a non-empty string");
    }
    if (!("default" in p)) return fail(`${at}.default`, "missing");
  }

  // --- layers → policies → allocations -----------------------------------
  // This is the nesting the resolver walks unconditionally.
  if (!Array.isArray(bundle.layers)) return fail("layers", "not an array");
  for (let li = 0; li < bundle.layers.length; li++) {
    const layer: unknown = bundle.layers[li];
    const layerAt = `layers[${li}]`;
    if (!isObject(layer)) return fail(layerAt, "not an object");
    if (!isNonEmptyString(layer.id)) {
      return fail(`${layerAt}.id`, "missing or not a non-empty string");
    }
    if (layer.unitKey !== undefined && typeof layer.unitKey !== "string") {
      return fail(`${layerAt}.unitKey`, "present but not a string");
    }
    if (!Array.isArray(layer.policies)) return fail(`${layerAt}.policies`, "not an array");

    for (let pi = 0; pi < layer.policies.length; pi++) {
      const policy: unknown = layer.policies[pi];
      const policyAt = `${layerAt}.policies[${pi}]`;
      if (!isObject(policy)) return fail(policyAt, "not an object");
      if (!isNonEmptyString(policy.id)) {
        return fail(`${policyAt}.id`, "missing or not a non-empty string");
      }
      if (!isNonEmptyString(policy.state)) {
        return fail(`${policyAt}.state`, "missing or not a non-empty string");
      }
      if (!Array.isArray(policy.allocations)) {
        return fail(`${policyAt}.allocations`, "not an array");
      }
      // `conditions` is dereferenced without a guard by the resolver.
      if (!Array.isArray(policy.conditions)) {
        return fail(`${policyAt}.conditions`, "not an array");
      }
      for (let ci = 0; ci < policy.conditions.length; ci++) {
        const cond: unknown = policy.conditions[ci];
        const condAt = `${policyAt}.conditions[${ci}]`;
        if (!isObject(cond)) return fail(condAt, "not an object");
        if (!isNonEmptyString(cond.field)) {
          return fail(`${condAt}.field`, "missing or not a non-empty string");
        }
        // The comparison operator is `op` — the spec's required field name.
        // Not `operator`: getting this wrong rejects every bundle that uses a
        // targeting condition, which is what the fixture conformance test below
        // exists to catch.
        if (!isNonEmptyString(cond.op)) {
          return fail(`${condAt}.op`, "missing or not a non-empty string");
        }
      }

      for (let ai = 0; ai < policy.allocations.length; ai++) {
        const alloc: unknown = policy.allocations[ai];
        const allocAt = `${policyAt}.allocations[${ai}]`;
        if (!isObject(alloc)) return fail(allocAt, "not an object");
        if (!isNonEmptyString(alloc.name)) {
          return fail(`${allocAt}.name`, "missing or not a non-empty string");
        }
        // A malformed range is the failure mode that does NOT announce
        // itself: PHP's parser coerces one into a live one-bucket range.
        // Reject it here rather than resolving a wrong population.
        const range: unknown = alloc.bucketRange;
        if (!Array.isArray(range) || range.length !== 2) {
          return fail(`${allocAt}.bucketRange`, "not a 2-element array");
        }
        const [start, end] = range as unknown[];
        if (
          typeof start !== "number" ||
          typeof end !== "number" ||
          !Number.isInteger(start) ||
          !Number.isInteger(end)
        ) {
          return fail(`${allocAt}.bucketRange`, "bounds are not integers");
        }
        if (start < 0 || end < start) {
          return fail(`${allocAt}.bucketRange`, "bounds are negative or inverted");
        }
        if (alloc.overrides !== undefined && !isObject(alloc.overrides)) {
          return fail(`${allocAt}.overrides`, "present but not an object");
        }
      }
    }
  }

  return { ok: true };
}

/** Convenience type guard for call sites that only need yes/no. */
export function isValidConfigBundle(bundle: unknown): bundle is ConfigBundle {
  return validateConfigBundle(bundle).ok;
}
