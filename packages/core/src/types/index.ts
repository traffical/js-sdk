/**
 * Traffical SDK Core Types
 *
 * These types define the contract between the SDK and the Control Plane.
 * They are designed to be self-contained and independent of the control-plane package.
 */

// =============================================================================
// Base Types
// =============================================================================

/** ISO 8601 timestamp string */
export type Timestamp = string;

/** Unique identifier */
export type Id = string;

/** Parameter value types supported by the system */
export type ParameterType = "string" | "number" | "boolean" | "json";

/** Runtime value for a parameter */
export type ParameterValue = string | number | boolean | Record<string, unknown>;

/** Context for evaluation - arbitrary key-value pairs */
export type Context = Record<string, unknown>;

// =============================================================================
// Config Bundle Types
// =============================================================================

/**
 * ConfigBundle - the complete configuration for a project/environment.
 * This is what the SDK fetches and caches.
 */
export interface ConfigBundle {
  /** ISO timestamp for cache invalidation / ETag generation */
  version: Timestamp;
  /** Organization ID */
  orgId: Id;
  /** Project ID */
  projectId: Id;
  /** Environment (e.g., "production", "staging") */
  env: string;
  /** Hashing configuration for deterministic bucket assignment */
  hashing: BundleHashingConfig;
  /** All parameters for this project/env with defaults and layer membership */
  parameters: BundleParameter[];
  /** All layers with their policies */
  layers: BundleLayer[];
  /** DOM bindings for automatic value application (optional for backwards compatibility) */
  domBindings?: BundleDOMBinding[];
  /**
   * Per-entity optimization state for per-entity adaptive policies.
   * Only included for policies with resolutionMode: "bundle".
   */
  entityState?: Record<Id, BundleEntityPolicyState>;
}

/**
 * Hashing configuration in the bundle.
 */
export interface BundleHashingConfig {
  /** The context field name to use as the unit key */
  unitKey: string;
  /** Total number of buckets for allocation */
  bucketCount: number;
}

/**
 * Parameter definition in the bundle.
 */
export interface BundleParameter {
  /** Parameter key (e.g., "ui.primaryColor", "pricing.discount") */
  key: string;
  /** Value type */
  type: ParameterType;
  /** Default value when no policy overrides apply */
  default: ParameterValue;
  /** The layer this parameter belongs to */
  layerId: Id;
  /** Namespace for organizational purposes */
  namespace: string;
}

/**
 * DOM binding definition in the bundle.
 * Links a parameter to a DOM element for automatic value application.
 */
export interface BundleDOMBinding {
  /** Parameter key (denormalized for SDK lookup) */
  parameterKey: string;
  /** CSS selector for the target element */
  selector: string;
  /** Which property to modify: 'innerHTML', 'textContent', 'src', 'href', etc. */
  property: string;
  /** URL pattern (regex) where this binding applies */
  urlPattern: string;
}

/**
 * Layer definition in the bundle.
 */
export interface BundleLayer {
  /** Layer ID */
  id: Id;
  /** Policies within this layer (evaluated in order) */
  policies: BundlePolicy[];
}

/**
 * Policy state determines whether it's active.
 */
export type PolicyState = "draft" | "running" | "paused" | "completed";

/**
 * Policy kind determines how allocations are managed.
 * - "static": Fixed allocations (A/B testing) - bucket ranges never change
 * - "adaptive": Dynamic allocations based on rewards (bandit-style learning)
 */
export type PolicyKind = "static" | "adaptive";

/**
 * Context logging configuration in the bundle.
 *
 * Defines which context fields should be logged in exposure events
 * for contextual bandit training.
 */
export interface BundleContextLogging {
  /**
   * Context fields to include in exposure events (allowlist).
   * Only these fields will be logged for training.
   */
  allowedFields: string[];
}

/**
 * Configuration for per-entity adaptive policies.
 *
 * When present on an adaptive policy, optimization happens at a granular level
 * (per product, per user, or any combination of context keys) instead of globally.
 */
export interface EntityConfig {
  /**
   * Context keys that identify the entity.
   * The entity ID is built by joining these key values with "_".
   */
  entityKeys: string[];

  /**
   * How to resolve entity state.
   * - "bundle": State shipped in config bundle, SDK resolves locally
   * - "edge": SDK calls edge API for fresh state
   */
  resolutionMode: "bundle" | "edge";

  /**
   * For edge mode: timeout in milliseconds before falling back to bundle.
   */
  edgeTimeoutMs?: number;

  /**
   * When set, allocations are dynamically derived from a context key
   * instead of being fixed in the policy definition.
   */
  dynamicAllocations?: {
    /** Context key containing the count of options */
    countKey: string;
  };
}

/**
 * Entity weights for per-entity resolution.
 */
export interface EntityWeights {
  /** Entity ID */
  entityId: string;
  /** Selection weights per allocation (sum to 1.0) */
  weights: number[];
  /** When these weights were computed */
  computedAt: Timestamp;
}

/**
 * Per-entity state for a single policy in the bundle.
 */
export interface BundleEntityPolicyState {
  /** Global prior weights (used for cold start) */
  _global: EntityWeights;
  /** Per-entity learned weights */
  entities: Record<string, EntityWeights>;
}

/**
 * Policy definition in the bundle.
 */
export interface BundlePolicy {
  /** Policy ID for tracking and analytics */
  id: Id;
  /** Current state */
  state: PolicyState;
  /** Policy kind: "static" for fixed allocations, "adaptive" for learning-based */
  kind: PolicyKind;
  /** Allocations: bucket ranges mapped to parameter overrides */
  allocations: BundleAllocation[];
  /** Conditions: context predicates that must all match for eligibility */
  conditions: BundleCondition[];
  /**
   * For adaptive policies: version of the optimization state.
   * Updated when the optimization engine changes allocations.
   */
  stateVersion?: Timestamp;
  /**
   * For adaptive policies: context fields to log in exposure events.
   * Only fields in the allowlist are included to protect PII.
   */
  contextLogging?: BundleContextLogging;
  /**
   * For per-entity adaptive policies: entity configuration.
   * When present, optimization happens at a granular level per entity.
   */
  entityConfig?: EntityConfig;
  /**
   * Optional bucket eligibility range for non-overlapping experiments.
   * When set, this policy only applies to users whose bucket falls within [start, end].
   * If not set, the policy applies to all buckets (default behavior).
   */
  eligibleBucketRange?: { start: number; end: number };
}

/**
 * Allocation in the bundle.
 */
export interface BundleAllocation {
  /** Unique allocation ID */
  id: Id;
  /** Variant name for tracking (e.g., "control", "treatment_a") */
  name: string;
  /** Bucket range [start, end] inclusive */
  bucketRange: [number, number];
  /** Parameter overrides for units in this bucket range */
  overrides: Record<string, ParameterValue>;
}

/**
 * Condition operators for context matching.
 */
export type ConditionOperator =
  | "eq"
  | "neq"
  | "in"
  | "nin"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "startsWith"
  | "endsWith"
  | "regex"
  | "exists"
  | "notExists";

/**
 * Condition in the bundle.
 */
export interface BundleCondition {
  /** Context field to evaluate */
  field: string;
  /** Comparison operator */
  op: ConditionOperator;
  /** Single value for binary operators */
  value?: unknown;
  /** Multiple values for "in"/"nin" operators */
  values?: unknown[];
}

// =============================================================================
// SDK-Specific Types
// =============================================================================

/**
 * Parameter defaults - simple key-value pairs for fallback values.
 * TypeScript will infer the types from the values provided.
 */
export type ParameterDefaults<T extends Record<string, ParameterValue> = Record<string, ParameterValue>> = T;

/**
 * Layer resolution info for tracking.
 */
export interface LayerResolution {
  layerId: Id;
  /** The bucket computed for this layer */
  bucket: number;
  /** The policy that was applied (if any) */
  policyId?: Id;
  /** The allocation ID that was selected (if any) */
  allocationId?: Id;
  /** The allocation/variant name that was selected (if any) */
  allocationName?: string;
}

/**
 * Decision result with metadata for tracking.
 */
export interface DecisionResult {
  /** Unique ID for this decision */
  decisionId: Id;
  /** Resolved parameter assignments */
  assignments: Record<string, ParameterValue>;
  /** Metadata about the resolution */
  metadata: DecisionMetadata;
}

/**
 * Metadata about a decision.
 */
export interface DecisionMetadata {
  /** Timestamp of the decision */
  timestamp: Timestamp;
  /** The unit key value used for bucket computation */
  unitKeyValue: string;
  /** Per-layer resolution info */
  layers: LayerResolution[];
  /**
   * Filtered context for exposure logging.
   * Contains only fields allowed by matched policies' contextLogging config.
   * Used for contextual bandit training without exposing PII.
   */
  filteredContext?: Context;
}

// =============================================================================
// Event Types (for SDK tracking)
// =============================================================================

/**
 * Base fields for events sent to the control plane.
 */
export interface BaseEventFields {
  /** Optional client-generated event ID */
  id?: Id;
  /** Organization ID */
  orgId: Id;
  /** Project ID */
  projectId: Id;
  /** Environment */
  env: string;
  /** Unit key value */
  unitKey: string;
  /** Event timestamp */
  timestamp: Timestamp;
  /** Optional context snapshot */
  context?: Context;
  /**
   * SDK that generated this event.
   * Examples: "js-client", "node", "react"
   */
  sdkName?: string;
  /**
   * Version of the SDK that generated this event.
   * Example: "0.1.0"
   */
  sdkVersion?: string;
}

/**
 * Exposure event for tracking parameter exposures.
 */
export interface ExposureEvent extends BaseEventFields {
  type: "exposure";
  /** Reference to the decision that was exposed */
  decisionId: Id;
  /** The parameter assignments that were exposed */
  assignments: Record<string, ParameterValue>;
  /** Per-layer resolution metadata */
  layers: LayerResolution[];
}

/**
 * Attribution for a track event to a specific policy/allocation.
 */
export interface TrackAttribution {
  layerId: Id;
  policyId: Id;
  allocationName: string;
  /** Attribution weight (0.0-1.0). Defaults to equal split if not provided. */
  weight?: number;
  /** Optional: which attribution model assigned this weight */
  model?: 'first_touch' | 'last_touch' | 'linear' | 'time_decay' | 'position_based';
}

/**
 * Track event - records user behavior/conversion.
 * 
 * Replaces the old ActionEvent and RewardEvent types.
 * Used for conversion tracking, engagement metrics, and optimization.
 */
export interface TrackEvent extends BaseEventFields {
  type: "track";
  /** Event name (e.g., 'purchase', 'add_to_cart', 'page_view') */
  event: string;
  /** Reference to the decision event for attribution */
  decisionId?: Id;
  /** Primary numeric value for optimization (e.g., revenue amount) */
  value?: number;
  /** Optional secondary values for multi-objective optimization */
  values?: Record<string, number>;
  /** Event properties/metadata (e.g., orderId, itemSku) */
  properties?: Record<string, unknown>;
  /**
   * Attribution chain - which policies/allocations influenced this.
   * SDK auto-populates this from cached decision when decisionId is provided.
   */
  attribution?: TrackAttribution[];
  /** For delayed events: the original event timestamp */
  eventTimestamp?: Timestamp;
}

/**
 * DecisionEvent - records that a decision was made (assignment computed).
 *
 * Used for:
 * - Intent-to-treat analysis: tracking all assignments, not just exposures
 * - Debugging: understanding why specific values were computed
 * - Audit trail: tracking all decisions made by the SDK
 *
 * Unlike ExposureEvent which is tracked when the user sees the variant,
 * DecisionEvent is tracked immediately when decide() is called.
 */
export interface DecisionEvent extends BaseEventFields {
  type: "decision";
  /** Parameters that were requested (keys from defaults) */
  requestedParameters?: string[];
  /** The resolved assignments */
  assignments: Record<string, ParameterValue>;
  /** Resolution metadata */
  layers: LayerResolution[];
  /** Processing time in milliseconds */
  latencyMs?: number;
}

/**
 * Union of all trackable events.
 */
export type TrackableEvent = ExposureEvent | TrackEvent | DecisionEvent;

// =============================================================================
// Client Configuration Types
// =============================================================================

/**
 * Options for creating a Traffical client.
 */
export interface TrafficalClientOptions {
  /** Organization ID */
  orgId: Id;
  /** Project ID */
  projectId: Id;
  /** Environment (e.g., "production", "staging") */
  env: string;
  /** API key for authentication */
  apiKey: string;
  /** Base URL for the control plane API (optional, defaults to Traffical cloud) */
  baseUrl?: string;
  /** Local config bundle for offline fallback */
  localConfig?: ConfigBundle;
  /** Refresh interval in milliseconds (default: 60000) */
  refreshIntervalMs?: number;
  /** Strict mode: throw on unknown or deprecated parameters */
  strictMode?: boolean;
}

/**
 * Options for parameter resolution.
 */
export interface GetParamsOptions<T extends Record<string, ParameterValue> = Record<string, ParameterValue>> {
  /** Context for evaluation */
  context: Context;
  /** Default values for parameters - used as fallback when bundle unavailable */
  defaults: T;
}

/**
 * Options for making a decision.
 */
export interface DecideOptions<T extends Record<string, ParameterValue> = Record<string, ParameterValue>> {
  /** Context for evaluation */
  context: Context;
  /** Default values for parameters - used as fallback when bundle unavailable */
  defaults: T;
}

/**
 * Options for tracking an event.
 */
export interface TrackOptions {
  /** Event name (e.g., 'purchase', 'add_to_cart') */
  event: string;
  /** Primary value for optimization (optional) */
  value?: number;
  /** Additional event properties */
  properties?: Record<string, unknown>;
  /** Reference to the decision (optional, SDK can auto-populate) */
  decisionId?: Id;
  /** Secondary values for multi-objective optimization */
  values?: Record<string, number>;
}

