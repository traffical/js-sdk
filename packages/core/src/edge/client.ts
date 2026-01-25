/**
 * Edge Client
 *
 * Client for making per-entity decisions via the edge worker API.
 * Used when policies have entityConfig.resolutionMode = "edge".
 *
 * The edge client provides:
 * - Real-time entity state resolution (vs batched bundle updates)
 * - Timeout handling with fallback to bundle
 * - Request batching for multiple entities
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

// =============================================================================
// Edge Client
// =============================================================================

/**
 * EdgeClient - makes per-entity decisions via the edge worker API.
 */
export class EdgeClient {
  private config: EdgeClientConfig;
  private defaultTimeout: number;

  constructor(config: EdgeClientConfig) {
    this.config = config;
    this.defaultTimeout = config.defaultTimeoutMs ?? 100;
  }

  /**
   * Makes a single entity decision via the edge API.
   *
   * @param request - The decide request
   * @param timeoutMs - Optional timeout override
   * @returns The decide response, or null if request failed/timed out
   */
  async decide(
    request: EdgeDecideRequest,
    timeoutMs?: number
  ): Promise<EdgeDecideResponse | null> {
    const timeout = timeoutMs ?? this.defaultTimeout;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const url = `${this.config.baseUrl}/v1/decide/${request.policyId}`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
          "X-Org-Id": this.config.orgId,
          "X-Project-Id": this.config.projectId,
          "X-Env": this.config.env,
        },
        body: JSON.stringify({
          entityId: request.entityId,
          unitKeyValue: request.unitKeyValue,
          allocationCount: request.allocationCount,
          context: request.context,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn(
          `[Traffical] Edge decide failed: ${response.status} ${response.statusText}`
        );
        return null;
      }

      return (await response.json()) as EdgeDecideResponse;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        console.warn(`[Traffical] Edge decide timed out after ${timeout}ms`);
      } else {
        console.warn(`[Traffical] Edge decide error:`, error);
      }
      return null;
    }
  }

  /**
   * Makes multiple entity decisions in a single batch request.
   *
   * @param requests - Array of decide requests
   * @param timeoutMs - Optional timeout override
   * @returns Array of responses (null for failed requests)
   */
  async decideBatch(
    requests: EdgeDecideRequest[],
    timeoutMs?: number
  ): Promise<(EdgeDecideResponse | null)[]> {
    if (requests.length === 0) return [];
    if (requests.length === 1) {
      const result = await this.decide(requests[0], timeoutMs);
      return [result];
    }

    const timeout = timeoutMs ?? this.defaultTimeout;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const url = `${this.config.baseUrl}/v1/decide/batch`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
          "X-Org-Id": this.config.orgId,
          "X-Project-Id": this.config.projectId,
          "X-Env": this.config.env,
        },
        body: JSON.stringify({ requests }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn(
          `[Traffical] Edge batch decide failed: ${response.status} ${response.statusText}`
        );
        return requests.map(() => null);
      }

      const data = (await response.json()) as EdgeBatchDecideResponse;
      return data.responses;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        console.warn(`[Traffical] Edge batch decide timed out after ${timeout}ms`);
      } else {
        console.warn(`[Traffical] Edge batch decide error:`, error);
      }
      return requests.map(() => null);
    }
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Creates an edge decide request from policy and context.
 *
 * @param policyId - The policy ID
 * @param entityKeys - Array of context keys that identify the entity
 * @param context - The evaluation context
 * @param unitKeyValue - The unit key value
 * @param allocationCount - Number of allocations (for dynamic)
 * @returns The decide request, or null if entity ID cannot be built
 */
export function createEdgeDecideRequest(
  policyId: Id,
  entityKeys: string[],
  context: Context,
  unitKeyValue: string,
  allocationCount?: number
): EdgeDecideRequest | null {
  // Build entity ID from context
  const parts: string[] = [];
  for (const key of entityKeys) {
    const value = context[key];
    if (value === undefined || value === null) {
      return null;
    }
    parts.push(String(value));
  }
  const entityId = parts.join("_");

  return {
    policyId,
    entityId,
    unitKeyValue,
    allocationCount,
    context,
  };
}

