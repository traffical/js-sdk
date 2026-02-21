/**
 * DecisionClient
 *
 * I/O client for Traffical server-evaluated resolution and per-entity decisions.
 * Platform-agnostic (uses standard fetch API).
 */

import type {
  Id,
  Context,
  EdgeDecideRequest,
  EdgeDecideResponse,
  EdgeBatchDecideResponse,
  ServerResolveRequest,
  ServerResolveResponse,
} from "@traffical/core";

// =============================================================================
// Configuration
// =============================================================================

export interface DecisionClientConfig {
  /** Base URL for the edge worker (e.g., "https://sdk.traffical.io") */
  baseUrl: string;
  /** Organization ID */
  orgId: Id;
  /** Project ID */
  projectId: Id;
  /** Environment */
  env: string;
  /** API key for authentication */
  apiKey: string;
  /** Default timeout in milliseconds (default: 5000 for resolve, 100 for decide) */
  defaultTimeoutMs?: number;
}

// =============================================================================
// DecisionClient
// =============================================================================

export class DecisionClient {
  private readonly config: DecisionClientConfig;
  private readonly defaultTimeout: number;

  constructor(config: DecisionClientConfig) {
    this.config = config;
    this.defaultTimeout = config.defaultTimeoutMs ?? 5000;
  }

  /**
   * Full server-side resolution via POST /v1/resolve.
   * Returns all parameter assignments resolved on the edge worker.
   */
  async resolve(request: ServerResolveRequest): Promise<ServerResolveResponse | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.defaultTimeout);

      const url = `${this.config.baseUrl}/v1/resolve`;
      const response = await fetch(url, {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify({
          context: request.context,
          env: request.env ?? this.config.env,
          parameters: request.parameters,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn(
          `[Traffical] Resolve failed: ${response.status} ${response.statusText}`
        );
        return null;
      }

      return (await response.json()) as ServerResolveResponse;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        console.warn(`[Traffical] Resolve timed out after ${this.defaultTimeout}ms`);
      } else {
        console.warn(`[Traffical] Resolve error:`, error);
      }
      return null;
    }
  }

  /**
   * Per-entity edge decision via POST /v1/decide/:policyId.
   */
  async decideEntity(
    request: EdgeDecideRequest,
    timeoutMs?: number
  ): Promise<EdgeDecideResponse | null> {
    const timeout = timeoutMs ?? Math.min(this.defaultTimeout, 100);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const url = `${this.config.baseUrl}/v1/decide/${request.policyId}`;
      const response = await fetch(url, {
        method: "POST",
        headers: this._headers(),
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
   * Batch per-entity edge decisions via POST /v1/decide/batch.
   */
  async decideEntityBatch(
    requests: EdgeDecideRequest[],
    timeoutMs?: number
  ): Promise<(EdgeDecideResponse | null)[]> {
    if (requests.length === 0) return [];
    if (requests.length === 1) {
      const result = await this.decideEntity(requests[0], timeoutMs);
      return [result];
    }

    const timeout = timeoutMs ?? Math.min(this.defaultTimeout, 200);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const url = `${this.config.baseUrl}/v1/decide/batch`;
      const response = await fetch(url, {
        method: "POST",
        headers: this._headers(),
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

  private _headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`,
      "X-Org-Id": this.config.orgId,
      "X-Project-Id": this.config.projectId,
      "X-Env": this.config.env,
    };
  }
}

// =============================================================================
// Utility Functions (moved from @traffical/core)
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
