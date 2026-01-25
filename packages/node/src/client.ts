/**
 * Traffical Node.js SDK Client
 *
 * HTTP client with caching, background refresh, and graceful degradation.
 * Wraps the pure core-ts resolution engine.
 *
 * Features:
 * - ETag-based caching for efficient config fetches
 * - Background refresh for keeping config up-to-date
 * - Automatic decision tracking for intent-to-treat analysis
 * - Batched event transport for efficiency
 * - Graceful degradation with local config and schema defaults
 */

import {
  type ConfigBundle,
  type Context,
  type DecisionResult,
  type ParameterValue,
  type TrafficalClientOptions as CoreClientOptions,
  type TrackOptions,
  type ExposureEvent,
  type TrackEvent,
  type TrackAttribution,
  type DecisionEvent,
  resolveParameters,
  decide as coreDecide,
  DecisionDeduplicator,
  generateExposureId,
  generateTrackEventId,
} from "@traffical/core";

import { EventBatcher } from "./event-batcher.js";

// =============================================================================
// Constants
// =============================================================================

const SDK_NAME = "node";
const SDK_VERSION = "0.1.0"; // Should match package.json version

const DEFAULT_BASE_URL = "https://sdk.traffical.io";
const DEFAULT_REFRESH_INTERVAL_MS = 60_000; // 1 minute
const OFFLINE_WARNING_INTERVAL_MS = 300_000; // 5 minutes
const DECISION_CACHE_MAX_SIZE = 1000; // Max decisions to cache for attribution lookup

// =============================================================================
// Types
// =============================================================================

/**
 * Options for the Node.js Traffical client.
 * Extends the core options with Node-specific settings.
 */
export interface TrafficalClientOptions extends CoreClientOptions {
  /**
   * Whether to automatically track decision events (default: true).
   * When enabled, every call to decide() automatically sends a DecisionEvent
   * to the backend, enabling intent-to-treat analysis.
   */
  trackDecisions?: boolean;
  /**
   * Decision deduplication TTL in milliseconds (default: 1 hour).
   * Same user+assignment combination won't be tracked again within this window.
   */
  decisionDeduplicationTtlMs?: number;
  /**
   * Event batch size - number of events before auto-flush (default: 10).
   */
  eventBatchSize?: number;
  /**
   * Event flush interval in milliseconds (default: 30000).
   */
  eventFlushIntervalMs?: number;
  /**
   * Enable debug logging for events (default: false).
   */
  debugEvents?: boolean;
}

// =============================================================================
// Client State
// =============================================================================

interface ClientState {
  bundle: ConfigBundle | null;
  etag: string | null;
  lastFetchTime: number;
  lastOfflineWarning: number;
  refreshTimer: ReturnType<typeof setInterval> | null;
  isInitialized: boolean;
}

// =============================================================================
// Traffical Client Class
// =============================================================================

/**
 * TrafficalClient - the main SDK client for Node.js environments.
 *
 * Features:
 * - ETag-based caching for efficient config fetches
 * - Background refresh for keeping config up-to-date
 * - Automatic decision tracking for intent-to-treat analysis
 * - Batched event transport for efficiency
 * - Graceful degradation with local config and schema defaults
 * - Rate-limited offline warnings
 */
export class TrafficalClient {
  private readonly _options: Required<
    Pick<
      TrafficalClientOptions,
      "orgId" | "projectId" | "env" | "apiKey" | "baseUrl" | "refreshIntervalMs" | "strictMode"
    >
  > & {
    localConfig?: ConfigBundle;
    trackDecisions: boolean;
  };

  private _state: ClientState = {
    bundle: null,
    etag: null,
    lastFetchTime: 0,
    lastOfflineWarning: 0,
    refreshTimer: null,
    isInitialized: false,
  };

  private readonly _eventBatcher: EventBatcher;
  private readonly _decisionDedup: DecisionDeduplicator;
  /** Cache of recent decisions for attribution lookup on rewards */
  private readonly _decisionCache: Map<string, DecisionResult> = new Map();

  constructor(options: TrafficalClientOptions) {
    this._options = {
      orgId: options.orgId,
      projectId: options.projectId,
      env: options.env,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl || DEFAULT_BASE_URL,
      localConfig: options.localConfig,
      refreshIntervalMs: options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS,
      strictMode: options.strictMode ?? false,
      trackDecisions: options.trackDecisions !== false, // Default: true
    };

    // Initialize event batcher
    this._eventBatcher = new EventBatcher({
      endpoint: `${this._options.baseUrl}/v1/events/batch`,
      apiKey: options.apiKey,
      batchSize: options.eventBatchSize,
      flushIntervalMs: options.eventFlushIntervalMs,
      debug: options.debugEvents,
      onError: (error) => {
        console.warn(`[Traffical] Event batching error: ${error.message}`);
      },
    });

    // Initialize decision deduplicator
    this._decisionDedup = new DecisionDeduplicator({
      ttlMs: options.decisionDeduplicationTtlMs,
    });

    // Initialize with local config if provided
    if (this._options.localConfig) {
      this._state.bundle = this._options.localConfig;
    }
  }

  /**
   * Initializes the client by fetching the config bundle.
   * This is called automatically by createTrafficalClient.
   */
  async initialize(): Promise<void> {
    await this._fetchConfig();
    this._startBackgroundRefresh();
    this._state.isInitialized = true;
  }

  /**
   * Stops background refresh and cleans up resources.
   */
  async destroy(): Promise<void> {
    if (this._state.refreshTimer) {
      clearInterval(this._state.refreshTimer);
      this._state.refreshTimer = null;
    }

    // Flush remaining events
    await this._eventBatcher.destroy();
  }

  /**
   * Synchronous destroy for process exit handlers.
   * Use destroy() when possible for proper cleanup.
   */
  destroySync(): void {
    if (this._state.refreshTimer) {
      clearInterval(this._state.refreshTimer);
      this._state.refreshTimer = null;
    }

    this._eventBatcher.destroySync();
  }

  /**
   * Manually refreshes the config bundle.
   */
  async refreshConfig(): Promise<void> {
    await this._fetchConfig();
  }

  /**
   * Gets the current config bundle version.
   */
  getConfigVersion(): string | null {
    return this._state.bundle?.version ?? null;
  }

  /**
   * Flush pending events immediately.
   */
  async flushEvents(): Promise<void> {
    await this._eventBatcher.flush();
  }

  /**
   * Resolves parameters with defaults as fallback.
   *
   * Resolution priority (highest wins):
   * 1. Policy overrides (from remote bundle)
   * 2. Parameter defaults (from remote bundle)
   * 3. Local config (if remote unavailable)
   * 4. Caller defaults
   */
  getParams<T extends Record<string, ParameterValue>>(options: { context: Context; defaults: T }): T {
    const bundle = this._getEffectiveBundle();
    return resolveParameters<T>(bundle, options.context, options.defaults);
  }

  /**
   * Makes a decision with full metadata for tracking.
   *
   * When trackDecisions is enabled (default), automatically sends a DecisionEvent
   * to the backend for intent-to-treat analysis.
   */
  decide<T extends Record<string, ParameterValue>>(options: { context: Context; defaults: T }): DecisionResult {
    const start = Date.now();
    const bundle = this._getEffectiveBundle();
    const decision = coreDecide<T>(bundle, options.context, options.defaults);
    const latencyMs = Date.now() - start;

    // Cache decision for attribution lookup when trackReward is called
    this._cacheDecision(decision);

    // Auto-track decision if enabled
    if (this._options.trackDecisions) {
      this._trackDecision(decision, latencyMs, Object.keys(options.defaults));
    }

    return decision;
  }

  /**
   * Tracks an exposure event.
   *
   * If the decision includes filtered context (from policies with contextLogging),
   * it will be included in the exposure event for contextual bandit training.
   */
  trackExposure(decision: DecisionResult): void {
    const unitKey = decision.metadata.unitKeyValue;
    if (!unitKey) {
      // Can't track without unit key
      return;
    }

    const event: ExposureEvent = {
      type: "exposure",
      id: generateExposureId(), // Unique exposure ID (not same as decision)
      decisionId: decision.decisionId,
      orgId: this._options.orgId,
      projectId: this._options.projectId,
      env: this._options.env,
      unitKey,
      timestamp: new Date().toISOString(),
      assignments: decision.assignments,
      layers: decision.metadata.layers,
      // Include filtered context for contextual bandit training
      context: decision.metadata.filteredContext,
      sdkName: SDK_NAME,
      sdkVersion: SDK_VERSION,
    };

    this._eventBatcher.log(event);
  }

  /**
   * Tracks a user event.
   *
   * @example
   * // Track a purchase with revenue
   * client.track('purchase', { value: 99.99, orderId: 'ord_123' });
   *
   * // Track a simple event
   * client.track('add_to_cart', { itemId: 'sku_456' });
   *
   * // Track with explicit decision attribution
   * client.track('checkout_complete', { value: 1 }, { decisionId: 'dec_xyz' });
   */
  track(
    event: string,
    properties?: Record<string, unknown>,
    options?: { decisionId?: string; unitKey?: string }
  ): void {
    const value = typeof properties?.value === 'number' ? properties.value : undefined;

    // Auto-populate attribution from cached decision if available
    const attribution = this._getAttributionFromCache(options?.decisionId);

    const trackEvent: TrackEvent = {
      type: "track",
      id: generateTrackEventId(),
      orgId: this._options.orgId,
      projectId: this._options.projectId,
      env: this._options.env,
      unitKey: options?.unitKey || "",
      timestamp: new Date().toISOString(),
      event,
      value,
      properties,
      decisionId: options?.decisionId,
      attribution,
      sdkName: SDK_NAME,
      sdkVersion: SDK_VERSION,
    };

    this._eventBatcher.log(trackEvent);
  }

  /**
   * @deprecated Use track() instead.
   * Tracks a reward event.
   * If decisionId is provided and the decision is cached, attribution is auto-populated.
   */
  trackReward(options: TrackOptions): void {
    // Map old API to new track() API
    this.track(options.event, options.properties, {
      decisionId: undefined, // Not available in old API without decisionId
    });
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Gets the effective bundle: remote > local > null
   */
  private _getEffectiveBundle(): ConfigBundle | null {
    return this._state.bundle ?? this._options.localConfig ?? null;
  }

  /**
   * Fetches the config bundle from the edge worker.
   * Uses ETag for efficient caching.
   */
  private async _fetchConfig(): Promise<void> {
    const url = `${this._options.baseUrl}/v1/config/${this._options.projectId}?env=${this._options.env}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this._options.apiKey}`,
    };

    // Add ETag for conditional request
    if (this._state.etag) {
      headers["If-None-Match"] = this._state.etag;
    }

    try {
      const response = await fetch(url, { method: "GET", headers });

      if (response.status === 304) {
        // Not modified - bundle is still valid
        this._state.lastFetchTime = Date.now();
        return;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const bundle = (await response.json()) as ConfigBundle;
      const etag = response.headers.get("ETag");

      this._state.bundle = bundle;
      this._state.etag = etag;
      this._state.lastFetchTime = Date.now();
    } catch (error) {
      this._logOfflineWarning(error);
    }
  }

  /**
   * Starts background refresh timer.
   */
  private _startBackgroundRefresh(): void {
    if (this._options.refreshIntervalMs <= 0) {
      return;
    }

    this._state.refreshTimer = setInterval(() => {
      this._fetchConfig().catch(() => {
        // Errors are logged in _fetchConfig
      });
    }, this._options.refreshIntervalMs);

    // Unref so timer doesn't keep process alive
    if (typeof this._state.refreshTimer.unref === "function") {
      this._state.refreshTimer.unref();
    }
  }

  /**
   * Logs an offline warning (rate-limited).
   */
  private _logOfflineWarning(error: unknown): void {
    const now = Date.now();
    if (now - this._state.lastOfflineWarning > OFFLINE_WARNING_INTERVAL_MS) {
      console.warn(
        `[Traffical] Failed to fetch config: ${error instanceof Error ? error.message : String(error)}. Using ${this._state.bundle ? "cached" : "local"} config.`
      );
      this._state.lastOfflineWarning = now;
    }
  }

  /**
   * Tracks a decision event (internal).
   * Called automatically when trackDecisions is enabled.
   */
  private _trackDecision(
    decision: DecisionResult,
    latencyMs: number,
    requestedParameters: string[]
  ): void {
    const unitKey = decision.metadata.unitKeyValue;
    if (!unitKey) {
      // Can't track without unit key
      return;
    }

    // Hash assignments for deduplication
    const hash = DecisionDeduplicator.hashAssignments(decision.assignments);

    // Check deduplication
    if (!this._decisionDedup.checkAndMark(unitKey, hash)) {
      return; // Duplicate, skip
    }

    // Build the decision event
    const event: DecisionEvent = {
      type: "decision",
      id: decision.decisionId,
      orgId: this._options.orgId,
      projectId: this._options.projectId,
      env: this._options.env,
      unitKey,
      timestamp: decision.metadata.timestamp,
      requestedParameters,
      assignments: decision.assignments,
      layers: decision.metadata.layers,
      latencyMs,
      // Include filtered context if available
      context: decision.metadata.filteredContext,
      sdkName: SDK_NAME,
      sdkVersion: SDK_VERSION,
    };

    this._eventBatcher.log(event);
  }

  /**
   * Caches a decision for attribution lookup when trackReward is called.
   * Maintains a bounded cache to prevent memory leaks.
   */
  private _cacheDecision(decision: DecisionResult): void {
    // Evict oldest entries if cache is full
    if (this._decisionCache.size >= DECISION_CACHE_MAX_SIZE) {
      // Get first (oldest) key and delete it
      const firstKey = this._decisionCache.keys().next().value;
      if (firstKey) {
        this._decisionCache.delete(firstKey);
      }
    }
    this._decisionCache.set(decision.decisionId, decision);
  }

  /**
   * Gets attribution info from cached decision if available.
   */
  private _getAttributionFromCache(decisionId?: string): TrackAttribution[] | undefined {
    if (!decisionId) {
      return undefined;
    }
    
    const cachedDecision = this._decisionCache.get(decisionId);
    if (!cachedDecision) {
      return undefined;
    }
    
    const attribution = cachedDecision.metadata.layers
      .filter((l) => l.policyId && l.allocationName)
      .map((l) => ({
        layerId: l.layerId,
        policyId: l.policyId!,
        allocationName: l.allocationName!,
      }));
    
    return attribution.length > 0 ? attribution : undefined;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates and initializes a Traffical client.
 *
 * @example
 * ```typescript
 * const traffical = await createTrafficalClient({
 *   orgId: "org_123",
 *   projectId: "proj_456",
 *   env: "production",
 *   apiKey: "sk_...",
 * });
 *
 * const params = traffical.getParams({
   *   context: { userId: "user_789" },
   *   defaults: {
   *     "ui.button.color": "#000",
   *   },
   * });
 * ```
 */
export async function createTrafficalClient(
  options: TrafficalClientOptions
): Promise<TrafficalClient> {
  const client = new TrafficalClient(options);
  await client.initialize();
  return client;
}

/**
 * Creates a Traffical client without initializing (synchronous).
 * Useful when you want to control initialization timing.
 */
export function createTrafficalClientSync(
  options: TrafficalClientOptions
): TrafficalClient {
  return new TrafficalClient(options);
}

