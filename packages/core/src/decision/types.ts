/**
 * Decision Types
 *
 * Types for the unified server-evaluated resolution endpoint (/v1/resolve).
 * Used by @traffical/core-io DecisionClient and the edge worker.
 */

import type { Context, ParameterValue, LayerResolution } from "../types/index.js";

/**
 * Request to the /v1/resolve endpoint for server-side resolution.
 */
export interface ServerResolveRequest {
  /** Evaluation context (must include the unit key) */
  context: Context;
  /** Environment name (defaults to "production") */
  env?: string;
  /** Optional subset of parameter keys to resolve */
  parameters?: string[];
}

/**
 * Response from the /v1/resolve endpoint.
 * Contains everything the SDK needs for downstream events.
 */
export interface ServerResolveResponse {
  /** Unique decision ID */
  decisionId: string;
  /** Resolved parameter assignments */
  assignments: Record<string, ParameterValue>;
  /** Resolution metadata for tracking and attribution */
  metadata: {
    timestamp: string;
    unitKeyValue: string;
    layers: LayerResolution[];
    filteredContext?: Context;
  };
  /** Bundle version used for resolution */
  stateVersion: string;
  /** Suggested refresh interval in milliseconds */
  suggestedRefreshMs?: number;
}
