/**
 * Resolution Engine
 *
 * Pure functions for parameter resolution using layered config and policies.
 * Implements the Google-inspired layering system where:
 * - Parameters are partitioned into layers
 * - Within a layer, only one policy can be active for a unit
 * - Across layers, policies overlap freely (different parameters)
 *
 * Resolution order (lowest to highest priority):
 * 1. Caller defaults (always safe fallback)
 * 2. Parameter defaults (from bundle)
 * 3. Layer policies (each parameter belongs to exactly one layer)
 */

import type {
  ConfigBundle,
  BundleParameter,
  BundlePolicy,
  BundleAllocation,
  Context,
  ParameterValue,
  DecisionResult,
  LayerResolution,
  Id,
} from "../types/index.js";
import { computeBucket, findMatchingAllocation } from "../hashing/bucket.js";
import { weightedSelection } from "../hashing/weighted.js";
import { evaluateConditions } from "./conditions.js";
import { resolveContextualPolicyDetailed } from "../scoring/contextual.js";
import { generateDecisionId } from "../ids/index.js";

/**
 * Filters context to only include fields allowed by matched policies.
 * Collects the union of all allowed fields from policies with contextLogging config.
 *
 * @param context - The full evaluation context
 * @param policies - Matched policies from resolution
 * @returns Filtered context with only allowed fields, or undefined if no fields allowed
 */
function filterContext(
  context: Context,
  policies: BundlePolicy[]
): Context | undefined {
  // Collect union of all allowed fields from matched policies
  const allowedFields = new Set<string>();
  for (const policy of policies) {
    if (policy.contextLogging?.allowedFields) {
      for (const field of policy.contextLogging.allowedFields) {
        allowedFields.add(field);
      }
    }
  }

  // If no fields are allowed, return undefined
  if (allowedFields.size === 0) {
    return undefined;
  }

  // Filter context to only include allowed fields
  const filtered: Context = {};
  for (const field of allowedFields) {
    if (field in context) {
      filtered[field] = context[field];
    }
  }

  // Return undefined if no fields matched
  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

// =============================================================================
// Per-Entity Resolution Helpers
// =============================================================================

/**
 * Builds an entity ID from context using the policy's entityKeys.
 *
 * @param entityKeys - Array of context keys that identify the entity
 * @param context - The evaluation context
 * @returns Entity ID string, or null if any key is missing
 */
function buildEntityId(entityKeys: string[], context: Context): string | null {
  const parts: string[] = [];
  for (const key of entityKeys) {
    const value = context[key];
    if (value === undefined || value === null) {
      return null;
    }
    parts.push(String(value));
  }
  return parts.join("_");
}

/**
 * Creates uniform weights for dynamic allocations.
 *
 * @param count - Number of allocations
 * @returns Array of equal weights summing to 1.0
 */
function createUniformWeights(count: number): number[] {
  if (count <= 0) return [];
  const weight = 1 / count;
  return Array(count).fill(weight);
}

/**
 * Gets entity weights from the bundle's entityState.
 *
 * @param bundle - The config bundle
 * @param policyId - The policy ID
 * @param entityId - The entity ID
 * @param allocationCount - Number of allocations (for dynamic allocations)
 * @returns Entity weights or uniform weights for cold start
 */
function getEntityWeights(
  bundle: ConfigBundle,
  policyId: Id,
  entityId: string,
  allocationCount: number
): number[] {
  const policyState = bundle.entityState?.[policyId];

  if (!policyState) {
    // No state for this policy - use uniform weights
    return createUniformWeights(allocationCount);
  }

  // Try entity-specific weights first
  const entityWeights = policyState.entities[entityId];
  if (entityWeights && entityWeights.weights.length === allocationCount) {
    return entityWeights.weights;
  }

  // Fall back to global prior
  const globalWeights = policyState._global;
  if (globalWeights && globalWeights.weights.length === allocationCount) {
    return globalWeights.weights;
  }

  // Last resort: uniform weights
  return createUniformWeights(allocationCount);
}

/**
 * Resolves a per-entity policy using weighted selection.
 *
 * @param bundle - The config bundle
 * @param policy - The policy with entityConfig
 * @param context - The evaluation context
 * @param unitKeyValue - The unit key value for hashing
 * @returns The selected allocation, its selection weight, and entity ID,
 *   or null if cannot resolve
 */
function resolvePerEntityPolicy(
  bundle: ConfigBundle,
  policy: BundlePolicy,
  context: Context,
  unitKeyValue: string
): { allocation: BundleAllocation; weight: number; entityId: string } | null {
  const entityConfig = policy.entityConfig;
  if (!entityConfig) return null;

  // Build entity ID from context
  const entityId = buildEntityId(entityConfig.entityKeys, context);
  if (!entityId) {
    // Missing entity keys - cannot resolve
    return null;
  }

  // Determine allocations
  let allocations: BundleAllocation[];
  let allocationCount: number;

  if (entityConfig.dynamicAllocations) {
    // Dynamic allocations from context
    const countKey = entityConfig.dynamicAllocations.countKey;
    const count = context[countKey];
    if (typeof count !== "number" || count <= 0) {
      return null;
    }
    allocationCount = Math.floor(count);

    // Create synthetic allocations for dynamic mode
    // Each allocation is an index (0, 1, 2, ..., count-1)
    allocations = Array.from({ length: allocationCount }, (_, i) => ({
      id: `${policy.id}_dynamic_${i}`,
      name: String(i),
      bucketRange: [0, 0] as [number, number], // Not used for per-entity
      overrides: {}, // Overrides are applied differently for dynamic
    }));
  } else {
    // Fixed allocations from policy
    allocations = policy.allocations;
    allocationCount = allocations.length;
  }

  if (allocationCount === 0) return null;

  // Get weights for this entity
  const weights = getEntityWeights(bundle, policy.id, entityId, allocationCount);

  // Deterministic weighted selection
  const seed = `${entityId}:${unitKeyValue}:${policy.id}`;
  const selectedIndex = weightedSelection(weights, seed);

  return {
    allocation: allocations[selectedIndex],
    // The weight the SDK actually used at decision time — logged as the
    // propensity of the chosen allocation for off-policy training.
    weight: weights[selectedIndex],
    entityId,
  };
}

/**
 * Extracts the unit key value from context using the bundle's hashing config.
 *
 * @param bundle - The config bundle
 * @param context - The evaluation context
 * @returns The unit key value as a string, or null if not found
 */
export function getUnitKeyValue(
  bundle: ConfigBundle,
  context: Context
): string | null {
  const value = context[bundle.hashing.unitKey];

  if (value === undefined || value === null) {
    return null;
  }

  return String(value);
}

/**
 * Returns the context field name the bundle buckets on (the project's primary
 * unit key). Adapters (e.g. the OpenFeature provider) map their own targeting
 * key onto this field before calling decide().
 *
 * @param bundle - The config bundle (may be null before load)
 * @returns the `hashing.unitKey` field name, or null when no bundle is loaded
 */
export function getUnitKeyField(bundle: ConfigBundle | null): string | null {
  return bundle?.hashing?.unitKey ?? null;
}

/**
 * Returns the id of the layer a parameter belongs to, or null if the parameter
 * is not present in the bundle. Adapters use this to select the owning layer's
 * resolution metadata (variant, propensity, …) for a single flag, since a
 * single-key decide() returns a LayerResolution for every matched layer
 * (siblings flagged `attributionOnly`), not just the flag's own layer.
 *
 * @param bundle - The config bundle (may be null before load)
 * @param key - The parameter key
 * @returns the owning layer id, or null when unknown
 */
export function getParameterLayerId(
  bundle: ConfigBundle | null,
  key: string
): string | null {
  if (!bundle) return null;
  const param = bundle.parameters.find((p) => p.key === key);
  return param?.layerId ?? null;
}

// =============================================================================
// Resolve Options (for server-evaluated mode)
// =============================================================================

/**
 * Options for resolution that allow injecting pre-fetched edge results.
 * Used by server-evaluated mode where the edge worker resolves all policies
 * (including per-entity) in a single request and passes results to the core engine.
 */
export interface ResolveOptions {
  /**
   * Pre-fetched edge results keyed by policyId.
   * When provided, edge-mode policies use these instead of being skipped.
   */
  edgeResults?: Map<string, { allocationIndex: number; entityId: string }>;
}

/**
 * Internal resolution result with metadata.
 */
interface ResolutionResult<T> {
  assignments: T;
  unitKeyValue: string;
  layers: LayerResolution[];
  /** Matched policies with context logging config */
  matchedPolicies: BundlePolicy[];
}

/**
 * Internal function that performs parameter resolution with metadata tracking.
 * This is the single source of truth for resolution logic.
 *
 * @param bundle - The config bundle (can be null if unavailable)
 * @param context - The evaluation context
 * @param defaults - Default values for parameters (required, used as fallback)
 * @returns Resolution result with assignments and metadata
 */
function resolveInternal<T extends Record<string, ParameterValue>>(
  bundle: ConfigBundle | null,
  context: Context,
  defaults: T,
  options?: ResolveOptions
): ResolutionResult<T> {
  // Start with caller defaults (always safe)
  const assignments = { ...defaults } as Record<string, ParameterValue>;
  const layers: LayerResolution[] = [];
  const matchedPolicies: BundlePolicy[] = [];

  // If no bundle, return defaults with empty metadata
  if (!bundle) {
    return { assignments: assignments as T, unitKeyValue: "", layers, matchedPolicies };
  }

  // Project-level unit key. Layers that don't override `unitKey` use this.
  // In multi-entity projects, individual layers may set `unitKey` to a
  // different context field (e.g. `merchantId` when the project default is
  // `customerId`); those layers compute their own unit value below.
  //
  // We no longer bail out when this is missing — some layers in multi-entity
  // projects may still resolve via their own unit key. The empty string we
  // store in `unitKeyValue` is the legacy "no project unit key" signal that
  // downstream code (decision events) already tolerates.
  //
  // See the diversion-types design in the Traffical SDK spec.
  const projectUnitKeyValue = getUnitKeyValue(bundle, context) ?? "";

  // Get requested parameter keys from defaults
  const requestedKeys = new Set(Object.keys(defaults));

  // Filter bundle parameters to only those requested
  const params = bundle.parameters.filter((p) => requestedKeys.has(p.key));

  // Apply bundle defaults (overrides caller defaults)
  for (const param of params) {
    if (param.key in assignments) {
      assignments[param.key] = param.default;
    }
  }

  // Group by layer
  const paramsByLayer = new Map<Id, BundleParameter[]>();
  for (const param of params) {
    const existing = paramsByLayer.get(param.layerId) || [];
    existing.push(param);
    paramsByLayer.set(param.layerId, existing);
  }

  // Process ALL layers for both parameter resolution and attribution.
  //
  // Layers with matching parameters get their overrides applied (parameter
  // resolution). Layers WITHOUT matching parameters are still processed for
  // bucket/policy/allocation matching so that decision events and track-event
  // attribution include the full set of experiments the user is assigned to.
  //
  // The `attributionOnly` flag distinguishes the two: layers resolved only for
  // attribution are marked `attributionOnly: true`, which tells trackExposure()
  // to skip them (avoiding exposure inflation for experiments the user didn't
  // actually see).
  for (const layer of bundle.layers) {
    const layerParams = paramsByLayer.get(layer.id);
    const hasParams = layerParams && layerParams.length > 0;

    // Per-layer unit key resolution. Layers in multi-entity projects may
    // override `unitKey` to read a different context field. When a layer's
    // unit value can't be resolved (missing context field), we still emit a
    // LayerResolution row (with `bucket = -1`) so decision events record the
    // skipped layer, but no bucket-based policy can match.
    const layerUnitKey = layer.unitKey;
    const hasOverride = layerUnitKey !== undefined && layerUnitKey !== null;

    // S1: an empty or whitespace-only layer `unitKey` override is INVALID
    // configuration. Skip the layer entirely — emit a bare skipped row
    // (bucket -1, with NO unitKey/unitKeyValue metadata), match no policy,
    // leave the layer's parameters at their defaults, and record no exposure.
    // We MUST NOT fall back to the project-level unit key, and MUST NOT use
    // the blank override string as a context lookup key. (This engine
    // previously treated "" as falsy and fell back to the project key — the
    // 1-of-4 outlier corrected here per spec 0.7.0 S1.)
    if (hasOverride && String(layerUnitKey).trim() === "") {
      layers.push({
        layerId: layer.id,
        bucket: -1,
        ...(hasParams ? {} : { attributionOnly: true }),
      });
      continue;
    }

    // A valid override reads a different context field; otherwise bucket on
    // the project-level unit value. A valid override naming a field that is
    // absent from the context likewise skips the layer (bucket -1) for the
    // missing-value reason, but its unitKey is still recorded for audit.
    const layerUnitValue = hasOverride
      ? String(context[layerUnitKey as string] ?? "")
      : projectUnitKeyValue;

    if (!layerUnitValue) {
      layers.push({
        layerId: layer.id,
        bucket: -1,
        ...(hasOverride ? { unitKey: layerUnitKey, unitKeyValue: "" } : {}),
        ...(hasParams ? {} : { attributionOnly: true }),
      });
      continue;
    }

    // Compute bucket (needed for both parameter resolution and attribution)
    const bucket = computeBucket(
      layerUnitValue,
      layer.id,
      bundle.hashing.bucketCount
    );

    let matchedPolicy: BundlePolicy | undefined;
    let matchedAllocation: BundleAllocation | undefined;
    // Propensity of the chosen allocation at decision time (adaptive
    // policies only — omitted for static policies and edge-resolved
    // per-entity policies where the SDK didn't compute the selection).
    let matchedProbability: number | undefined;
    // Model version for linear_contextual selections.
    let matchedModelVersion: string | undefined;

    // Find matching policy
    for (const policy of layer.policies) {
      if (policy.state !== "running") continue;

      // Check bucket eligibility BEFORE conditions (performance optimization)
      // This enables non-overlapping experiments within a layer
      if (policy.eligibleBucketRange) {
        const { start, end } = policy.eligibleBucketRange;
        if (bucket < start || bucket > end) {
          continue; // User's bucket not eligible for this policy
        }
      }

      if (!evaluateConditions(policy.conditions, context)) continue;

      // Contextual model scoring: overrides bucket-based allocation
      if (policy.contextualModel) {
        const ctxResolution = resolveContextualPolicyDetailed(policy, context, layerUnitValue);
        if (ctxResolution) {
          matchedPolicy = policy;
          matchedAllocation = ctxResolution.allocation;
          matchedProbability = ctxResolution.probability;
          // S7: model timestamp of the coefficients used is the bundle
          // model's `generatedAt`, falling back only to its `modelVersion`
          // alias. There is NO further fallback to `policy.stateVersion` — if
          // both are absent we omit `modelVersion` entirely rather than emit a
          // wrong label.
          matchedModelVersion =
            policy.contextualModel.generatedAt ??
            policy.contextualModel.modelVersion;
          matchedPolicies.push(policy);
          if (hasParams) {
            for (const [key, value] of Object.entries(ctxResolution.allocation.overrides)) {
              if (key in assignments) {
                assignments[key] = value;
              }
            }
          }
          break;
        }
      }

      // Check if this is a per-entity policy
      if (policy.entityConfig && policy.entityConfig.resolutionMode === "bundle") {
        const result = resolvePerEntityPolicy(bundle, policy, context, layerUnitValue);
        if (result) {
          matchedPolicy = policy;
          matchedAllocation = result.allocation;
          // The entity weight the SDK actually used for weighted selection.
          matchedProbability = result.weight;

          // Track matched policy for context filtering
          matchedPolicies.push(policy);

          // Apply overrides only if this layer has matching parameters
          if (hasParams) {
            // For dynamic allocations, the allocation name IS the value
            if (policy.entityConfig.dynamicAllocations) {
              // For per-entity dynamic policies, we return the selected index
              // The SDK caller should use metadata.allocationName to get the index
              // No parameter overrides to apply in this mode
            } else {
              // For fixed allocations, apply normal overrides
              for (const [key, value] of Object.entries(result.allocation.overrides)) {
                if (key in assignments) {
                  assignments[key] = value;
                }
              }
            }
          }
          break; // Only one policy per layer
        }
      } else if (policy.entityConfig && policy.entityConfig.resolutionMode === "edge") {
        const edgeResult = options?.edgeResults?.get(policy.id);
        if (edgeResult) {
          matchedPolicy = policy;
          matchedPolicies.push(policy);

          if (policy.entityConfig.dynamicAllocations) {
            // Dynamic allocations: synthesize allocation from index
            matchedAllocation = {
              id: `${policy.id}_dynamic_${edgeResult.allocationIndex}`,
              name: String(edgeResult.allocationIndex),
              bucketRange: [0, 0] as [number, number],
              overrides: {},
            };
          } else if (policy.allocations[edgeResult.allocationIndex]) {
            matchedAllocation = policy.allocations[edgeResult.allocationIndex];
            if (hasParams && matchedAllocation) {
              for (const [key, value] of Object.entries(matchedAllocation.overrides)) {
                if (key in assignments) {
                  assignments[key] = value;
                }
              }
            }
          }
          break;
        }
        // No pre-fetched result: skip this policy gracefully
        continue;
      } else {
        // Standard bucket-based resolution
        const allocation = findMatchingAllocation(bucket, policy.allocations);
        if (allocation) {
          matchedPolicy = policy;
          matchedAllocation = allocation;

          // For adaptive (bandit) policies the bucket-range share IS the
          // selection probability at decision time. Static policies omit
          // the field — their assignment is a fixed split, not a propensity.
          if (policy.kind === "adaptive") {
            const [rangeStart, rangeEnd] = allocation.bucketRange;
            matchedProbability =
              (rangeEnd - rangeStart + 1) / bundle.hashing.bucketCount;
          }

          // Track matched policy for context filtering
          matchedPolicies.push(policy);

          // Apply overrides only if this layer has matching parameters
          if (hasParams) {
            for (const [key, value] of Object.entries(allocation.overrides)) {
              if (key in assignments) {
                assignments[key] = value;
              }
            }
          }
          break; // Only one policy per layer
        }
      }
    }

    layers.push({
      layerId: layer.id,
      bucket,
      policyId: matchedPolicy?.id,
      policyKey: (matchedPolicy as any)?.key,
      allocationId: matchedAllocation?.id,
      allocationName: matchedAllocation?.name,
      allocationKey: (matchedAllocation as any)?.key,
      // Propensity of the chosen allocation (adaptive policies only) and
      // the contextual model version — logged for off-policy training.
      // The events schema requires probability in (0, 1]; omit out-of-range
      // values (e.g. the zero-weight fallback of weightedSelection or an
      // inconsistent bucketCount) rather than clamping.
      ...(matchedProbability !== undefined &&
      matchedProbability > 0 &&
      matchedProbability <= 1
        ? { probability: matchedProbability }
        : {}),
      ...(matchedModelVersion !== undefined ? { modelVersion: matchedModelVersion } : {}),
      // Record the unit key only when the layer overrides the project
      // default — keeps the metadata small for the single-entity case while
      // making exposure events auditable in multi-entity projects.
      ...(hasOverride ? { unitKey: layerUnitKey, unitKeyValue: layerUnitValue } : {}),
      // Mark layers without requested parameters as attribution-only.
      // These are included in decision events and track-event attribution
      // but skipped by trackExposure() to avoid exposure inflation.
      ...(hasParams ? {} : { attributionOnly: true }),
    });
  }

  return { assignments: assignments as T, unitKeyValue: projectUnitKeyValue, layers, matchedPolicies };
}

/**
 * Resolves parameters with required defaults as fallback.
 * This is the primary SDK function that guarantees safe defaults.
 *
 * Resolution priority (highest wins):
 * 1. Policy overrides (from bundle)
 * 2. Parameter defaults (from bundle)
 * 3. Caller defaults (always safe fallback)
 *
 * @param bundle - The config bundle (can be null if unavailable)
 * @param context - The evaluation context
 * @param defaults - Default values for parameters (required, used as fallback)
 * @returns Resolved parameter assignments (always returns safe values with inferred types)
 */
export function resolveParameters<T extends Record<string, ParameterValue>>(
  bundle: ConfigBundle | null,
  context: Context,
  defaults: T,
  options?: ResolveOptions
): T {
  return resolveInternal(bundle, context, defaults, options).assignments;
}

/**
 * Makes a decision with full metadata for tracking.
 * Requires defaults for graceful degradation.
 *
 * Resolution priority (highest wins):
 * 1. Policy overrides (from bundle)
 * 2. Parameter defaults (from bundle)
 * 3. Caller defaults (always safe fallback)
 *
 * @param bundle - The config bundle (can be null if unavailable)
 * @param context - The evaluation context
 * @param defaults - Default values for parameters (required, used as fallback)
 * @returns Decision result with metadata (always returns safe values)
 */
export function decide<T extends Record<string, ParameterValue>>(
  bundle: ConfigBundle | null,
  context: Context,
  defaults: T,
  options?: ResolveOptions
): DecisionResult {
  const { assignments, unitKeyValue, layers, matchedPolicies } = resolveInternal(
    bundle,
    context,
    defaults,
    options
  );

  // Filter context based on matched policies' contextLogging config
  const filteredContext = filterContext(context, matchedPolicies);

  return {
    decisionId: generateDecisionId(),
    assignments,
    metadata: {
      timestamp: new Date().toISOString(),
      unitKeyValue,
      layers,
      filteredContext,
      // Snapshot the bundle version at decision time so events built later
      // stamp the version this decision was actually evaluated against.
      ...(bundle?.version ? { configVersion: bundle.version } : {}),
    },
  };
}
