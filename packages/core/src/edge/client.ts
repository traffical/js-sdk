/**
 * Edge Client Types
 *
 * Type interfaces for per-entity decisions via the edge worker API.
 * Used when policies have entityConfig.resolutionMode = "edge".
 *
 * The EdgeClient class has been moved to @traffical/core-io.
 */

import type { Id, Context } from "../types/index.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Request to the edge /decide endpoint.
 */
export interface EdgeDecideRequest {
  /** Policy ID */
  policyId: Id;
  /** Entity ID (composite from entityKeys) */
  entityId: string;
  /** Unit key value for deterministic selection */
  unitKeyValue: string;
  /** Number of allocations (for dynamic allocations) */
  allocationCount?: number;
  /** Full context (for logging/debugging) */
  context?: Context;
}

/**
 * Response from the edge /decide endpoint.
 */
export interface EdgeDecideResponse {
  /** Selected allocation index */
  allocationIndex: number;
  /** Selected allocation name */
  allocationName: string;
  /** Weights used for selection */
  weights: number[];
  /** Whether this was a cold start (no entity state) */
  coldStart: boolean;
  /** Entity state version */
  stateVersion?: string;
}

/**
 * Batch request for multiple entity decisions.
 */
export interface EdgeBatchDecideRequest {
  /** Array of individual decide requests */
  requests: EdgeDecideRequest[];
}

/**
 * Batch response for multiple entity decisions.
 */
export interface EdgeBatchDecideResponse {
  /** Array of individual decide responses (same order as requests) */
  responses: EdgeDecideResponse[];
}

/**
 * Edge client configuration.
 */
export interface EdgeClientConfig {
  /** Base URL for the edge worker (e.g., "https://edge.traffical.io") */
  baseUrl: string;
  /** Organization ID */
  orgId: Id;
  /** Project ID */
  projectId: Id;
  /** Environment */
  env: string;
  /** API key for authentication */
  apiKey: string;
  /** Default timeout in milliseconds */
  defaultTimeoutMs?: number;
}
