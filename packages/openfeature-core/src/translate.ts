import {
  StandardResolutionReasons,
  TypeMismatchError,
} from "@openfeature/core";
import type { FlagMetadata, JsonValue, ResolutionDetails } from "@openfeature/core";
import type { DecisionResult, LayerResolution } from "@traffical/core";
import { FLAG_METADATA_PREFIX } from "./constants.js";
import type { OFFlagType } from "./types.js";

/**
 * Selects the layer that OWNS a flag from a decision's per-layer metadata.
 *
 * A single-key `decide()` returns a `LayerResolution` for EVERY layer the unit
 * is bucketed into — the flag's layer plus every sibling (siblings flagged
 * `attributionOnly: true`). Positional `layers[0]` would attach the WRONG
 * experiment's variant/propensity/metadata, so we never index positionally.
 *
 * - When `ownerLayerId` is known, return the layer whose `layerId` matches.
 * - When `ownerLayerId` is null, fall back to the SOLE non-`attributionOnly`
 *   layer (there is exactly one per single-key decide — the flag's own layer).
 * - Otherwise `undefined` (no owner found → DEFAULT downstream).
 */
export function selectOwnerLayer(
  decision: DecisionResult,
  ownerLayerId: string | null
): LayerResolution | undefined {
  const layers = decision.metadata.layers;

  if (ownerLayerId !== null) {
    return layers.find((l) => l.layerId === ownerLayerId);
  }

  return layers.find((l) => l.attributionOnly !== true);
}

/**
 * Derives the OpenFeature `reason` from the owning layer.
 *
 * A present `allocationName` means the unit was assigned a variant by
 * pseudorandom bucketing (static A/B) or bandit selection — both are
 * `SPLIT` per the OpenFeature spec. Absence → `DEFAULT`.
 */
export function deriveReason(layer: LayerResolution | undefined): string {
  return layer?.allocationName
    ? StandardResolutionReasons.SPLIT
    : StandardResolutionReasons.DEFAULT;
}

/**
 * Sets a scalar `flagMetadata` key iff the source value is neither undefined
 * nor null. Ids are coerced to string. OpenFeature `flagMetadata` values must
 * be `string | number | boolean` — never nested, never undefined/null.
 */
function setScalar(
  meta: FlagMetadata,
  key: string,
  value: string | number | boolean | undefined | null
): void {
  if (value === undefined || value === null) return;
  meta[`${FLAG_METADATA_PREFIX}.${key}`] = value;
}

/**
 * Builds the `traffical.*` `flagMetadata` for a resolution.
 *
 * Scalar-only (`string | number | boolean`); any key whose source is
 * undefined/null is OMITTED (key-absent, never an undefined/null value).
 * Guardrails:
 * - `bucket` omitted when `< 0` (the engine's "no bucket" sentinel).
 * - `propensity` (layer.probability) omitted entirely when `gatePropensity` is
 *   set (web) — it exposes bandit selection internals in browser devtools.
 * Ids are coerced to string.
 */
export function buildFlagMetadata(
  decision: DecisionResult,
  layer: LayerResolution | undefined,
  opts?: { gatePropensity?: boolean }
): FlagMetadata {
  const meta: FlagMetadata = {};

  setScalar(meta, "decisionId", decision.decisionId);

  if (layer) {
    setScalar(meta, "policyId", layer.policyId !== undefined ? String(layer.policyId) : undefined);
    setScalar(meta, "policyKey", layer.policyKey);
    setScalar(
      meta,
      "allocationId",
      layer.allocationId !== undefined ? String(layer.allocationId) : undefined
    );
    setScalar(meta, "allocationKey", layer.allocationKey);
    setScalar(meta, "layerId", String(layer.layerId));
    if (layer.bucket !== undefined && layer.bucket >= 0) {
      setScalar(meta, "bucket", layer.bucket);
    }
    if (!opts?.gatePropensity) {
      setScalar(meta, "propensity", layer.probability);
    }
    setScalar(meta, "modelVersion", layer.modelVersion);
  }

  setScalar(meta, "configVersion", decision.metadata.configVersion);

  return meta;
}

/**
 * Strict type check — no coercion. `"true" → true` / `1 → true` returns a value
 * the flag author never declared under a non-error reason, so on mismatch we
 * throw `TypeMismatchError` and let the OpenFeature SDK (the never-throw
 * boundary) map it to the default + `reason: ERROR`.
 */
function matchesType(raw: unknown, expectedType: OFFlagType): boolean {
  switch (expectedType) {
    case "boolean":
      return typeof raw === "boolean";
    case "string":
      return typeof raw === "string";
    case "number":
      return typeof raw === "number";
    case "object":
      return (typeof raw === "object" && raw !== null) || Array.isArray(raw);
  }
}

/**
 * The main translation: a Traffical `DecisionResult` → an OpenFeature
 * `ResolutionDetails` for a single flag.
 *
 * - Selects the flag's owning layer (never positional).
 * - Reads `decision.assignments[flagKey]`, falling back to `defaultValue` when
 *   the key is absent.
 * - Strictly type-checks the value; on mismatch THROWS `TypeMismatchError`
 *   (does not coerce, does not silently return default). The OpenFeature SDK
 *   wraps every resolver and is the never-throw boundary, so throwing typed
 *   errors is correct and idiomatic.
 *
 * @throws {TypeMismatchError} when the resolved value's runtime type does not
 *   match `expectedType`.
 */
export function toResolutionDetails<T extends JsonValue>(args: {
  flagKey: string;
  defaultValue: T;
  expectedType: OFFlagType;
  decision: DecisionResult;
  ownerLayerId: string | null;
  gatePropensity?: boolean;
}): ResolutionDetails<T> {
  const { flagKey, defaultValue, expectedType, decision, ownerLayerId, gatePropensity } = args;

  const layer = selectOwnerLayer(decision, ownerLayerId);

  const raw =
    flagKey in decision.assignments ? decision.assignments[flagKey] : defaultValue;

  if (!matchesType(raw, expectedType)) {
    throw new TypeMismatchError(
      `Flag "${flagKey}" resolved to a value of type "${
        Array.isArray(raw) ? "object" : typeof raw
      }" but "${expectedType}" was expected`
    );
  }

  return {
    value: raw as T,
    variant: layer?.allocationName,
    reason: deriveReason(layer),
    flagMetadata: buildFlagMetadata(decision, layer, { gatePropensity }),
  };
}
