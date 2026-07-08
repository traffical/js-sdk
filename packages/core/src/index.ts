/**
 * @traffical/core
 *
 * Pure TypeScript core for Traffical SDK.
 * This package performs no I/O and can be used in any JavaScript environment.
 *
 * Key features:
 * - Deterministic parameter resolution
 * - SHA-256 v2 hashing for bucket assignment
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
  // Contextual model types
  BundleContextualModel,
  BundleAllocationCoefficients,
  BundleNumericCoefficient,
  BundleCategoricalCoefficient,
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
  // Warehouse-native assignment logger types
  AssignmentLogEntry,
  AssignmentLogger,
  AssignmentType,
  TrackableEventLogger,
  // Client types
  TrafficalClientOptions,
  GetParamsOptions,
  DecideOptions,
  TrackOptions,
  // Typed event tracking
  TrackEventMap,
  TypedTrackFn,
  SchemaViolation,
  EventSchemaWarning,
  EventBatchResponse,
  OnSchemaWarnings,
} from "./types/index.js";

// Hashing
export {
  assignmentInput,
  sha256Digest,
  hash64BE,
  hashInt64,
  utf8ByteLength,
  ASSIGNMENT_HASH_VERSION,
  computeBucket,
  isInBucketRange,
  findMatchingAllocation,
  percentageToBucketRange,
  createBucketRanges,
  weightedSelection,
} from "./hashing/index.js";

// Resolution
export {
  resolveParameters,
  decide,
  getUnitKeyValue,
  getUnitKeyField,
  getParameterLayerId,
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

// Scoring (contextual bandits)
export {
  computeAllocationScore,
  softmaxProbabilities,
  applyProbabilityFloor,
  resolveContextualPolicy,
  resolveContextualPolicyDetailed,
  type ContextualResolution,
} from "./scoring/index.js";

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
  generateAssignmentId,
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

