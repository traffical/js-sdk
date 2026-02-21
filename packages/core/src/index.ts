/**
 * @traffical/core
 *
 * Pure TypeScript core for Traffical SDK.
 * This package performs no I/O and can be used in any JavaScript environment.
 *
 * Key features:
 * - Deterministic parameter resolution
 * - FNV-1a hashing for bucket assignment
 * - Condition evaluation for targeting
 * - Defaults-based graceful degradation
 */

// Types
export type {
  // Base types
  Timestamp,
  Id,
  ParameterType,
  ParameterValue,
  Context,
  // Bundle types
  ConfigBundle,
  BundleHashingConfig,
  BundleParameter,
  BundleDOMBinding,
  BundleLayer,
  BundlePolicy,
  BundleAllocation,
  BundleCondition,
  PolicyState,
  PolicyKind,
  ConditionOperator,
  // Per-entity types
  EntityConfig,
  EntityWeights,
  BundleEntityPolicyState,
  // SDK types
  ParameterDefaults,
  DecisionResult,
  DecisionMetadata,
  LayerResolution,
  // Event types
  BaseEventFields,
  ExposureEvent,
  TrackEvent,
  TrackAttribution,
  DecisionEvent,
  TrackableEvent,
  // Client types
  TrafficalClientOptions,
  GetParamsOptions,
  DecideOptions,
  TrackOptions,
} from "./types/index.js";

// Hashing
export {
  fnv1a,
  computeBucket,
  isInBucketRange,
  findMatchingAllocation,
  percentageToBucketRange,
  createBucketRanges,
} from "./hashing/index.js";

// Resolution
export {
  resolveParameters,
  decide,
  getUnitKeyValue,
  type ResolveOptions,
  evaluateCondition,
  evaluateConditions,
  // Condition builders
  eq,
  neq,
  inValues,
  notIn,
  gt,
  gte,
  lt,
  lte,
  contains,
  startsWith,
  endsWith,
  regex,
  exists,
  notExists,
} from "./resolution/index.js";

// Deduplication
export {
  DecisionDeduplicator,
  type DecisionDeduplicatorOptions,
} from "./dedup/index.js";

// ID Generation
export {
  // Event IDs (ULID - time-sortable)
  generateEventId,
  generateDecisionId,
  generateExposureId,
  generateTrackEventId,
  // Entity IDs (8-char NanoID)
  generateEntityId,
  generateShortId,
  generateOrgId,
  generateProjectId,
  generateEnvironmentId,
  generateNamespaceId,
  generateLayerId,
  generatePolicyId,
  generateAllocationId,
  generateParameterId,
  generateDomBindingId,
  generateOverrideId,
  generateApiKeyId,
  // Utilities
  getIdTimestamp,
  getEventIdTimestamp, // deprecated
  // Types
  type EventIdPrefix,
  type EntityIdPrefix,
} from "./ids/index.js";

// Edge types (for per-entity policies)
// EdgeClient class and createEdgeDecideRequest moved to @traffical/core-io
export type {
  EdgeClientConfig,
  EdgeDecideRequest,
  EdgeDecideResponse,
  EdgeBatchDecideRequest,
  EdgeBatchDecideResponse,
} from "./edge/index.js";

// Decision types (for server-evaluated mode)
export type {
  ServerResolveRequest,
  ServerResolveResponse,
} from "./decision/index.js";

