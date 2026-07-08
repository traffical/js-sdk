import { TargetingKeyMissingError } from "@openfeature/core";
import type { Context } from "@traffical/core";

/**
 * Builds the Traffical evaluation context from an OpenFeature evaluation
 * context's targeting key + attributes.
 *
 * The engine buckets on `context[bundle.hashing.unitKey]` — NOT a field named
 * `"targetingKey"` — so we must write the targeting value under the bundle's
 * unit-key field (obtained via `client.getUnitKeyField()`). Writing it only
 * under `"targetingKey"` would let the web client's `_enrichContext` inject its
 * anonymous stableId under the real unit-key field, silently mis-bucketing.
 *
 * @throws {TargetingKeyMissingError} when `targetingKey` is null/undefined/empty.
 */
export function buildTrafficalContext(args: {
  targetingKey: string | undefined;
  attributes: Record<string, unknown>;
  unitKeyField: string | null;
}): Context {
  const { targetingKey, attributes, unitKeyField } = args;

  if (targetingKey === null || targetingKey === undefined || targetingKey === "") {
    throw new TargetingKeyMissingError();
  }

  // Degraded fallback: when the bundle isn't loaded we can't know the unit-key
  // field, so we write under "targetingKey" only.
  const field = unitKeyField ?? "targetingKey";

  return {
    ...attributes,
    targetingKey,
    [field]: targetingKey,
  };
}
