/**
 * TrafficalClient - JavaScript SDK for browser environments.
 *
 * Features:
 * - Same API as Node SDK: getParams(), decide(), trackExposure(), track()
 * - Error boundary wrapping (P0)
 * - Exposure deduplication (P0)
 * - Smart event batching with beacon on unload (P1)
 * - Plugin system (P2)
 * - Auto stable ID for anonymous users
 */

import {
  type ConfigBundle,
  type Context,
  type DecisionResult,
  type ParameterValue,
  type ExposureEvent,
  type TrackEvent,
  type TrackAttribution,
  type DecisionEvent,
  resolveParameters,
  decide as coreDecide,
  generateExposureId,
  generateTrackEventId,
  generateDecisionId,
} from "@traffical/core";

import { ErrorBoundary, type ErrorBoundaryOptions } from "./error-boundary.js";
import { EventLogger } from "./event-logger.js";
import { ExposureDeduplicator } from "./exposure-dedup.js";
import { StableIdProvider } from "./stable-id.js";
import { createStorageProvider, type StorageProvider } from "./storage.js";
import { PluginManager, type TrafficalPlugin, createDecisionTrackingPlugin } from "./plugins/index.js";

// =============================================================================
// Constants
// =============================================================================

const SDK_NAME = "js-client";
const SDK_VERSION = "0.1.0"; // Should match package.json version

const DEFAULT_BASE_URL = "https://sdk.traffical.io";
const DEFAULT_REFRESH_INTERVAL_MS = 60_000; // 1 minute
const OFFLINE_WARNING_INTERVAL_MS = 300_000; // 5 minutes
const DECISION_CACHE_MAX_SIZE = 100; // Max decisions to cache for attribution lookup

// =============================================================================
// Types
// =============================================================================

export interface TrafficalClientOptions {
  /** Organization ID */
  orgId: string;
  /** Project ID */
  projectId: string;
  /** Environment (e.g., "production", "staging") */
  env: string;
  /** API key for authentication */
  apiKey: string;
  /** Base URL for the SDK API (edge worker) */
  baseUrl?: string;
  /** Local config bundle for offline fallback */
  localConfig?: ConfigBundle;
  /** Refresh interval in milliseconds (default: 60000) */
  refreshIntervalMs?: number;
  /** Error boundary options */
  errorBoundary?: ErrorBoundaryOptions;
  /** Event batching options */
  eventBatchSize?: number;
  eventFlushIntervalMs?: number;
  /** Exposure deduplication session TTL */
  exposureSessionTtlMs?: number;
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
  /** Plugins to register on init */
  plugins?: TrafficalPlugin[];
  /** Custom storage provider (default: localStorage) */
  storage?: StorageProvider;
  /** Disable automatic stable ID generation */
  disableAutoStableId?: boolean;
  /**
   * Attribution mode for track events (default: "cumulative").
   * - "cumulative": Attributes to ALL layers the user was exposed to in this session.
   *   Best for cross-page funnels (catalog -> PDP -> checkout).
   * - "decision": Attributes only to the layers from the specific decision.
   *   Use when strict single-decision attribution is required.
   */
  attributionMode?: "cumulative" | "decision";
}

interface ClientState {
  bundle: ConfigBundle | null;
  etag: string | null;
  lastFetchTime: number;
  lastOfflineWarning: number;
  refreshTimer: ReturnType<typeof setInterval> | null;
  isInitialized: boolean;
}

// =============================================================================
// TrafficalClient Class
// =============================================================================

export class TrafficalClient {
  private readonly _options: Required<
    Pick<TrafficalClientOptions, "orgId" | "projectId" | "env" | "apiKey" | "baseUrl" | "refreshIntervalMs">
  > & { localConfig?: ConfigBundle; attributionMode: "cumulative" | "decision" };

  private _state: ClientState = {
    bundle: null,
    etag: null,
    lastFetchTime: 0,
    lastOfflineWarning: 0,
    refreshTimer: null,
    isInitialized: false,
  };

  private readonly _errorBoundary: ErrorBoundary;
  private readonly _storage: StorageProvider;
  private readonly _eventLogger: EventLogger;
  private readonly _exposureDedup: ExposureDeduplicator;
  private readonly _stableId: StableIdProvider;
  private readonly _plugins: PluginManager;
  /** Cache of recent decisions for attribution lookup when track() is called */
  private readonly _decisionCache: Map<string, DecisionResult> = new Map();

  constructor(options: TrafficalClientOptions) {
    this._options = {
      orgId: options.orgId,
      projectId: options.projectId,
      env: options.env,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      localConfig: options.localConfig,
      refreshIntervalMs: options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS,
      attributionMode: options.attributionMode ?? "cumulative",
    };

    // Initialize components
    this._errorBoundary = new ErrorBoundary(options.errorBoundary);
    this._storage = options.storage ?? createStorageProvider();

    this._eventLogger = new EventLogger({
      endpoint: `${this._options.baseUrl}/v1/events/batch`,
      apiKey: options.apiKey,
      storage: this._storage,
      batchSize: options.eventBatchSize,
      flushIntervalMs: options.eventFlushIntervalMs,
      onError: (error) => {
        console.warn("[Traffical] Event logging error:", error.message);
      },
    });

    this._exposureDedup = new ExposureDeduplicator({
      storage: this._storage,
      sessionTtlMs: options.exposureSessionTtlMs,
    });

    this._stableId = new StableIdProvider({
      storage: this._storage,
    });

    this._plugins = new PluginManager();

    // Register decision tracking plugin (enabled by default)
    if (options.trackDecisions !== false) {
      this._plugins.register({
        plugin: createDecisionTrackingPlugin(
          { deduplicationTtlMs: options.decisionDeduplicationTtlMs },
          {
            orgId: this._options.orgId,
            projectId: this._options.projectId,
            env: this._options.env,
            log: (event: DecisionEvent) => this._eventLogger.log(event),
          }
        ),
        priority: 100, // High priority so it runs before user plugins
      });
    }

    // Register user-provided plugins
    if (options.plugins) {
      for (const plugin of options.plugins) {
        this._plugins.register(plugin);
      }
    }

    // Initialize with local config if provided
    if (this._options.localConfig) {
      this._state.bundle = this._options.localConfig;
      // Notify plugins about the local config
      this._plugins.runConfigUpdate(this._options.localConfig);
    }
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  /**
   * Initializes the client by fetching the config bundle.
   */
  async initialize(): Promise<void> {
    await this._errorBoundary.captureAsync(
      "initialize",
      async () => {
        await this._fetchConfig();
        this._startBackgroundRefresh();
        this._state.isInitialized = true;

        // Run plugin onInitialize hooks
        await this._plugins.runInitialize();
      },
      undefined
    );
  }

  /**
   * Check if the client is initialized.
   */
  get isInitialized(): boolean {
    return this._state.isInitialized;
  }

  /**
   * Stops background refresh and cleans up resources.
   */
  destroy(): void {
    if (this._state.refreshTimer) {
      clearInterval(this._state.refreshTimer);
      this._state.refreshTimer = null;
    }

    // Flush any remaining events
    this._eventLogger.flushBeacon();
    this._eventLogger.destroy();

    // Run plugin onDestroy hooks
    this._plugins.runDestroy();
  }

  // ===========================================================================
  // Config Management
  // ===========================================================================

  /**
   * Manually refreshes the config bundle.
   */
  async refreshConfig(): Promise<void> {
    await this._errorBoundary.swallow("refreshConfig", async () => {
      await this._fetchConfig();
    });
  }

  /**
   * Gets the current config bundle version.
   */
  getConfigVersion(): string | null {
    return this._state.bundle?.version ?? null;
  }

  // ===========================================================================
  // Parameter Resolution
  // ===========================================================================

  /**
   * Resolves parameters with defaults as fallback.
   */
  getParams<T extends Record<string, ParameterValue>>(options: { context: Context; defaults: T }): T {
    return this._errorBoundary.capture(
      "getParams",
      () => {
        const bundle = this._getEffectiveBundle();
        const context = this._enrichContext(options.context);
        const params = resolveParameters<T>(bundle, context, options.defaults);

        // Run plugin onResolve hooks (e.g., DOM binding plugin)
        this._plugins.runResolve(params);

        return params;
      },
      options.defaults
    );
  }

  /**
   * Makes a decision with full metadata for tracking.
   */
  decide<T extends Record<string, ParameterValue>>(options: { context: Context; defaults: T }): DecisionResult {
    return this._errorBoundary.capture(
      "decide",
      () => {
        const bundle = this._getEffectiveBundle();

        // Run plugin onBeforeDecision hooks
        let context = this._enrichContext(options.context);
        context = this._plugins.runBeforeDecision(context);

        const decision = coreDecide<T>(bundle, context, options.defaults);

        // Cache decision for attribution lookup when track() is called
        this._cacheDecision(decision);

        // Run plugin onDecision hooks (e.g., DOM binding plugin)
        this._plugins.runDecision(decision);

        return decision;
      },
      {
        decisionId: generateDecisionId(),
        assignments: options.defaults,
        metadata: {
          timestamp: new Date().toISOString(),
          unitKeyValue: "",
          layers: [],
        },
      }
    );
  }

  // ===========================================================================
  // Event Tracking
  // ===========================================================================

  /**
   * Tracks an exposure event.
   * Automatically deduplicates exposures for the same user/variant.
   */
  trackExposure(decision: DecisionResult): void {
    this._errorBoundary.capture(
      "trackExposure",
      () => {
        const unitKey = decision.metadata.unitKeyValue;
        if (!unitKey) return;

        // Check each layer for deduplication
        for (const layer of decision.metadata.layers) {
          if (!layer.policyId || !layer.allocationName) continue;

          // Deduplicate
          const isNew = this._exposureDedup.checkAndMark(unitKey, layer.policyId, layer.allocationName);
          if (!isNew) continue;

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
            context: decision.metadata.filteredContext,
            sdkName: SDK_NAME,
            sdkVersion: SDK_VERSION,
          };

          // Run plugin onExposure hooks
          if (!this._plugins.runExposure(event)) {
            continue;
          }

          this._eventLogger.log(event);
        }
      },
      undefined
    );
  }

  /**
   * Tracks a user event.
   * 
   * @param eventName - The event name (e.g., 'purchase', 'add_to_cart')
   * @param properties - Optional event properties (including value for optimization)
   * @param options - Optional tracking options (decisionId, unitKey)
   * 
   * @example
   * // Track a purchase with revenue
   * client.track('purchase', { value: 99.99, orderId: 'ord_123' });
   * 
   * // Track a simple event
   * client.track('add_to_cart', { itemId: 'sku_456' });
   * 
   * // Track with explicit decision attribution
   * client.track('checkout_complete', { value: 1 }, { decisionId: decision.decisionId });
   */
  track(
    eventName: string,
    properties?: Record<string, unknown>,
    options?: { decisionId?: string; unitKey?: string }
  ): void {
    this._errorBoundary.capture(
      "track",
      () => {
        const unitKey = options?.unitKey ?? this._stableId.getId();
        const value = typeof properties?.value === 'number' ? properties.value : undefined;

        // Auto-populate attribution from cached decisions
        const attribution = this._buildAttribution(unitKey, options?.decisionId);
        const decisionId = options?.decisionId;

        const event: TrackEvent = {
          type: "track",
          id: generateTrackEventId(),
          orgId: this._options.orgId,
          projectId: this._options.projectId,
          env: this._options.env,
          unitKey,
          timestamp: new Date().toISOString(),
          event: eventName,
          value,
          properties,
          decisionId,
          attribution,
          sdkName: SDK_NAME,
          sdkVersion: SDK_VERSION,
        };

        // Run plugin onTrack hooks
        if (!this._plugins.runTrack(event)) {
          return;
        }

        this._eventLogger.log(event);
      },
      undefined
    );
  }

  /**
   * Flush pending events immediately.
   */
  async flushEvents(): Promise<void> {
    await this._errorBoundary.swallow("flushEvents", async () => {
      await this._eventLogger.flush();
    });
  }

  // ===========================================================================
  // Plugin Management
  // ===========================================================================

  /**
   * Register a plugin.
   */
  use(plugin: TrafficalPlugin): this {
    this._plugins.register(plugin);
    return this;
  }

  /**
   * Get a registered plugin by name.
   */
  getPlugin(name: string): TrafficalPlugin | undefined {
    return this._plugins.get(name);
  }

  // ===========================================================================
  // Stable ID
  // ===========================================================================

  /**
   * Get the stable ID for the current user.
   */
  getStableId(): string {
    return this._stableId.getId();
  }

  /**
   * Set a custom stable ID (e.g., when user logs in).
   */
  setStableId(id: string): void {
    this._stableId.setId(id);
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private _getEffectiveBundle(): ConfigBundle | null {
    return this._state.bundle ?? this._options.localConfig ?? null;
  }

  private _enrichContext(context: Context): Context {
    // Add stable ID if not already present
    const bundle = this._getEffectiveBundle();
    const unitKey = bundle?.hashing?.unitKey ?? "userId";

    if (!context[unitKey]) {
      return {
        ...context,
        [unitKey]: this._stableId.getId(),
      };
    }

    return context;
  }

  private async _fetchConfig(): Promise<void> {
    const url = `${this._options.baseUrl}/v1/config/${this._options.projectId}?env=${this._options.env}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this._options.apiKey}`,
    };

    if (this._state.etag) {
      headers["If-None-Match"] = this._state.etag;
    }

    try {
      const response = await fetch(url, { method: "GET", headers });

      if (response.status === 304) {
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

      // Run plugin onConfigUpdate hooks (e.g., DOM binding plugin)
      this._plugins.runConfigUpdate(bundle);
    } catch (error) {
      this._logOfflineWarning(error);
    }
  }

  private _startBackgroundRefresh(): void {
    if (this._options.refreshIntervalMs <= 0) return;

    this._state.refreshTimer = setInterval(() => {
      this._fetchConfig().catch(() => {
        // Errors logged in _fetchConfig
      });
    }, this._options.refreshIntervalMs);
  }

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
   * Caches a decision for attribution lookup when track() is called.
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
   * Builds attribution for a track event based on the configured attribution mode.
   *
   * - "cumulative": Collects layers from ALL cached decisions for this unit,
   *   deduplicated by layerId:policyId (last-write-wins). This ensures cross-page
   *   funnels (e.g., catalog -> PDP -> checkout) attribute correctly to all
   *   experiments the user is exposed to. For per-entity dynamic allocation
   *   policies, only the most recent allocation is kept to avoid attributing
   *   rewards to allocations from other entities (e.g., different products).
   *
   * - "decision": Only uses layers from the single decision matching decisionId.
   *   Legacy behavior for strict single-decision attribution.
   */
  private _buildAttribution(
    unitKey: string,
    decisionId?: string
  ): TrackAttribution[] | undefined {
    if (this._options.attributionMode === "decision") {
      // Legacy behavior: single-decision attribution
      if (!decisionId) return undefined;
      const cachedDecision = this._decisionCache.get(decisionId);
      if (!cachedDecision) return undefined;
      return cachedDecision.metadata.layers
        .filter((l) => l.policyId && l.allocationName)
        .map((l) => ({
          layerId: l.layerId,
          policyId: l.policyId!,
          allocationName: l.allocationName!,
        }));
    }

    // Cumulative mode: collect attribution from ALL cached decisions for this unit.
    // Deduplicate by layerId:policyId (last-write-wins) so that for per-entity
    // dynamic allocation policies, only the MOST RECENT allocation is kept.
    // This is critical because each product page resolves a different allocation
    // index, and the track event should only credit the allocation matching the
    // most recent context (e.g., the product currently being viewed).
    // For normal policies this is a no-op since the allocationName is deterministic.
    const attrMap = new Map<string, TrackAttribution>();
    for (const cachedDecision of this._decisionCache.values()) {
      // Only include decisions for the same unit to prevent cross-user attribution
      if (cachedDecision.metadata.unitKeyValue !== unitKey) continue;
      for (const l of cachedDecision.metadata.layers) {
        if (!l.policyId || !l.allocationName) continue;
        const key = `${l.layerId}:${l.policyId}`;
        // Last-write-wins: later decisions (more recent) overwrite earlier ones
        attrMap.set(key, {
          layerId: l.layerId,
          policyId: l.policyId,
          allocationName: l.allocationName,
        });
      }
    }

    return attrMap.size > 0 ? Array.from(attrMap.values()) : undefined;
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Creates and initializes a Traffical client.
 */
export async function createTrafficalClient(options: TrafficalClientOptions): Promise<TrafficalClient> {
  const client = new TrafficalClient(options);
  await client.initialize();
  return client;
}

/**
 * Creates a Traffical client without initializing (synchronous).
 */
export function createTrafficalClientSync(options: TrafficalClientOptions): TrafficalClient {
  return new TrafficalClient(options);
}

