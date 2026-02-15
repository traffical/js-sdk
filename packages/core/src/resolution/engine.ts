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
import { evaluateConditions } from "./conditions.js";
import { generateDecisionId } from "../ids/index.js";
import { fnv1a } from "../hashing/fnv1a.js";

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
 * Performs deterministic weighted selection using a hash.
 *
 * Uses the entity ID + unit key + policy ID to deterministically select
 * an allocation based on weights. This ensures the same entity always
 * gets the same allocation for a given weight distribution.
 *
 * @param weights - Array of weights (should sum to 1.0)
 * @param seed - Seed string for deterministic hashing
 * @returns Index of selected allocation
 */
function weightedSelection(weights: number[], seed: string): number {
  if (weights.length === 0) return 0;
  if (weights.length === 1) return 0;

  // Compute a deterministic random value in [0, 1) using hash
  const hash = fnv1a(seed);
  const random = (hash % 10000) / 10000;

  // Select based on cumulative weights
  let cumulative = 0;
  for (let i = 0; i < weights.length; i++) {
    cumulative += weights[i];
    if (random < cumulative) {
      return i;
    }
  }

  // Fallback to last allocation (handles floating point edge cases)
  return weights.length - 1;
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
 * @returns The selected allocation and entity ID, or null if cannot resolve
 */
function resolvePerEntityPolicy(
  bundle: ConfigBundle,
  policy: BundlePolicy,
  context: Context,
  unitKeyValue: string
): { allocation: BundleAllocation; entityId: string } | null {
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
  defaults: T
): ResolutionResult<T> {
  // Start with caller defaults (always safe)
  const assignments = { ...defaults } as Record<string, ParameterValue>;
  const layers: LayerResolution[] = [];
  const matchedPolicies: BundlePolicy[] = [];

  // If no bundle, return defaults with empty metadata
  if (!bundle) {
    return { assignments: assignments as T, unitKeyValue: "", layers, matchedPolicies };
  }

  // Try to get unit key
  const unitKeyValue = getUnitKeyValue(bundle, context);
  if (!unitKeyValue) {
    // Missing unit key - return defaults
    return { assignments: assignments as T, unitKeyValue: "", layers, matchedPolicies };
  }

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

    // Compute bucket (needed for both parameter resolution and attribution)
    const bucket = computeBucket(
      unitKeyValue,
      layer.id,
      bundle.hashing.bucketCount
    );

    let matchedPolicy: BundlePolicy | undefined;
    let matchedAllocation: BundleAllocation | undefined;

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

      // Check if this is a per-entity policy
      if (policy.entityConfig && policy.entityConfig.resolutionMode === "bundle") {
        const result = resolvePerEntityPolicy(bundle, policy, context, unitKeyValue);
        if (result) {
          matchedPolicy = policy;
          matchedAllocation = result.allocation;

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
        // Edge mode: skip for now, will be handled by SDK's async resolution
        // In synchronous resolution, we fall through to bucket-based resolution
        // The SDK should use async decide() for edge mode policies
        continue;
      } else {
        // Standard bucket-based resolution
        const allocation = findMatchingAllocation(bucket, policy.allocations);
        if (allocation) {
          matchedPolicy = policy;
          matchedAllocation = allocation;

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
      allocationId: matchedAllocation?.id,
      allocationName: matchedAllocation?.name,
      // Mark layers without requested parameters as attribution-only.
      // These are included in decision events and track-event attribution
      // but skipped by trackExposure() to avoid exposure inflation.
      ...(hasParams ? {} : { attributionOnly: true }),
    });
  }

  return { assignments: assignments as T, unitKeyValue, layers, matchedPolicies };
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
  defaults: T
): T {
  return resolveInternal(bundle, context, defaults).assignments;
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
  defaults: T
): DecisionResult {
  const { assignments, unitKeyValue, layers, matchedPolicies } = resolveInternal(
    bundle,
    context,
    defaults
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
    },
  };
}
