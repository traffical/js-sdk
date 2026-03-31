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
  type BundlePolicy,
  type ServerResolveResponse,
  type ResolveOptions,
  type AssignmentLogger,
  resolveParameters,
  decide as coreDecide,
  getUnitKeyValue,
  generateExposureId,
  generateTrackEventId,
  generateDecisionId,
} from "@traffical/core";

import {
  DecisionClient,
  createEdgeDecideRequest,
  type DecisionClientConfig,
} from "@traffical/core-io";

import { ErrorBoundary, type ErrorBoundaryOptions } from "./error-boundary.js";
import { EventLogger } from "./event-logger.js";
import { ExposureDeduplicator } from "./exposure-dedup.js";
import { StableIdProvider } from "./stable-id.js";
import { createStorageProvider, type StorageProvider } from "./storage.js";
import { PluginManager, type TrafficalPlugin, createDecisionTrackingPlugin } from "./plugins/index.js";
import { createBrowserLifecycleProvider, type LifecycleProvider } from "./lifecycle.js";
import { SDK_VERSION } from "./version.js";

// =============================================================================
// Constants
// =============================================================================

const SDK_NAME = "js-client";

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
  /**
   * Evaluation mode (default: "bundle").
   * - "bundle": SDK fetches config bundle, resolves parameters locally.
   * - "server": SDK delegates resolution to the edge worker via POST /v1/resolve.
   */
  evaluationMode?: "bundle" | "server";
  /** Lifecycle provider for visibility/unload events (default: browser lifecycle) */
  lifecycleProvider?: LifecycleProvider;

  /**
   * Optional callback for routing assignment events to a customer-managed
   * pipeline (e.g., Segment, Rudderstack, direct DB writes).
   *
   * When provided, called on every decide()/trackExposure() with a structured
   * AssignmentLogEntry. Enables the "BYO assignment pipeline" pattern for
   * warehouse-native analytics.
   */
  assignmentLogger?: AssignmentLogger;

  /**
   * When true, the SDK will NOT send events (decisions, exposures, tracks)
   * to the Traffical control plane. The SDK still fetches config from
   * Traffical CDN/edge for flag evaluation.
   *
   * Default: false
   */
  disableCloudEvents?: boolean;

  /**
   * When true, assignment logger calls are deduplicated per session
   * (same unit+policy+variant won't fire again). Default: true.
   */
  deduplicateAssignmentLogger?: boolean;
}

interface ClientState {
  bundle: ConfigBundle | null;
  etag: string | null;
  lastFetchTime: number;
  lastOfflineWarning: number;
  refreshTimer: ReturnType<typeof setInterval> | null;
  isInitialized: boolean;
  /** Cached server resolve response (server mode only) */
  serverResponse: ServerResolveResponse | null;
  /** Cached edge results for bundle mode with edge policies */
  cachedEdgeResults: ResolveOptions | null;
}

// =============================================================================
// TrafficalClient Class
// =============================================================================

export class TrafficalClient {
  private readonly _options: Required<
    Pick<TrafficalClientOptions, "orgId" | "projectId" | "env" | "apiKey" | "baseUrl" | "refreshIntervalMs">
  > & {
    localConfig?: ConfigBundle;
    attributionMode: "cumulative" | "decision";
    evaluationMode: "bundle" | "server";
  };

  private _state: ClientState = {
    bundle: null,
    etag: null,
    lastFetchTime: 0,
    lastOfflineWarning: 0,
    refreshTimer: null,
    isInitialized: false,
    serverResponse: null,
    cachedEdgeResults: null,
  };

  private readonly _errorBoundary: ErrorBoundary;
  private readonly _storage: StorageProvider;
  private readonly _eventLogger: EventLogger;
  private readonly _exposureDedup: ExposureDeduplicator;
  private readonly _stableId: StableIdProvider;
  private readonly _plugins: PluginManager;
  private readonly _lifecycleProvider: LifecycleProvider;
  private readonly _decisionClient: DecisionClient | null;
  private readonly _assignmentLogger?: AssignmentLogger;
  private readonly _disableCloudEvents: boolean;
  private readonly _assignmentLoggerDedup: ExposureDeduplicator | null;
  /** Cache of recent decisions for attribution lookup when track() is called */
  private readonly _decisionCache: Map<string, DecisionResult> = new Map();
  /**
   * Cumulative attribution map, keyed by unitKey → layerId:policyId → TrackAttribution.
   * Unlike _decisionCache (bounded to DECISION_CACHE_MAX_SIZE), this map accumulates
   * every attribution entry from every decide() call during the session. This prevents
   * attribution loss when per-entity policies (e.g. per-product OptimizedProductCards)
   * flood the decision cache and evict earlier page-level decisions.
   */
  private readonly _cumulativeAttribution: Map<string, Map<string, TrackAttribution>> = new Map();
  private _identityListeners: Array<(unitKey: string) => void> = [];
  private _overrides: Record<string, ParameterValue> = {};

  constructor(options: TrafficalClientOptions) {
    const evaluationMode = options.evaluationMode ?? "bundle";
    this._options = {
      orgId: options.orgId,
      projectId: options.projectId,
      env: options.env,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      localConfig: options.localConfig,
      refreshIntervalMs: options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS,
      attributionMode: options.attributionMode ?? "cumulative",
      evaluationMode,
    };

    // Create DecisionClient when needed (server mode, or bundle mode may use for edge policies)
    const decisionClientConfig: DecisionClientConfig = {
      baseUrl: this._options.baseUrl,
      orgId: this._options.orgId,
      projectId: this._options.projectId,
      env: this._options.env,
      apiKey: this._options.apiKey,
    };
    this._decisionClient = new DecisionClient(decisionClientConfig);

    // Initialize components
    this._errorBoundary = new ErrorBoundary(options.errorBoundary);
    this._storage = options.storage ?? createStorageProvider();
    this._lifecycleProvider = options.lifecycleProvider ?? createBrowserLifecycleProvider();

    this._eventLogger = new EventLogger({
      endpoint: `${this._options.baseUrl}/v1/events/batch`,
      apiKey: options.apiKey,
      storage: this._storage,
      lifecycleProvider: this._lifecycleProvider,
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

    // Warehouse-native options
    this._assignmentLogger = options.assignmentLogger;
    this._disableCloudEvents = options.disableCloudEvents ?? false;
    this._assignmentLoggerDedup = (options.deduplicateAssignmentLogger !== false && options.assignmentLogger)
      ? new ExposureDeduplicator({ storage: this._storage, sessionTtlMs: options.exposureSessionTtlMs })
      : null;

    // Register decision tracking plugin (enabled by default, skipped when cloud events disabled)
    if (options.trackDecisions !== false && !this._disableCloudEvents) {
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

    // Register on global instance list so DevTools can discover ES-module SDKs
    if (typeof window !== "undefined") {
      const w = window as unknown as Record<string, unknown>;
      (w.__TRAFFICAL_INSTANCES__ ??= [] as TrafficalClient[]) as TrafficalClient[];
      (w.__TRAFFICAL_INSTANCES__ as TrafficalClient[]).push(this);
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
        if (this._options.evaluationMode === "server") {
          await this._fetchServerResolve();
        } else {
          await this._fetchConfig();
        }
        this._startBackgroundRefresh();
        this._state.isInitialized = true;

        // Run plugin onInitialize hooks (pass client reference for autonomous plugins)
        await this._plugins.runInitialize(this);
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

    if (this._lifecycleProvider.isUnloading()) {
      this._eventLogger.flushBeacon();
    } else {
      this._eventLogger.flush().catch(() => {});
    }
    this._eventLogger.destroy();

    // Run plugin onDestroy hooks
    this._plugins.runDestroy();

    // Clear identity listeners and overrides
    this._identityListeners = [];
    this._overrides = {};

    // Remove from global instance list
    if (typeof window !== "undefined") {
      const w = window as unknown as Record<string, unknown>;
      const instances = w.__TRAFFICAL_INSTANCES__ as TrafficalClient[] | undefined;
      if (instances) {
        const idx = instances.indexOf(this);
        if (idx !== -1) instances.splice(idx, 1);
      }
    }
  }

  // ===========================================================================
  // Config Management
  // ===========================================================================

  /**
   * Manually refreshes the config bundle.
   */
  async refreshConfig(): Promise<void> {
    await this._errorBoundary.swallow("refreshConfig", async () => {
      if (this._options.evaluationMode === "server") {
        await this._fetchServerResolve();
      } else {
        await this._fetchConfig();
      }
    });
  }

  /**
   * Gets the current config bundle version.
   */
  getConfigVersion(): string | null {
    return this._state.serverResponse?.stateVersion ?? this._state.bundle?.version ?? null;
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
        // Server mode: return from cached server response
        if (this._options.evaluationMode === "server" && this._state.serverResponse) {
          const result = { ...options.defaults } as Record<string, ParameterValue>;
          for (const [key, value] of Object.entries(this._state.serverResponse.assignments)) {
            if (key in result) {
              result[key] = value;
            }
          }
          this._plugins.runResolve(result as T);
          this._applyOverridesToResult(result);
          return result as T;
        }

        const bundle = this._getEffectiveBundle();
        const context = this._enrichContext(options.context);
        const params = resolveParameters<T>(bundle, context, options.defaults);

        // Run plugin onResolve hooks (e.g., DOM binding plugin)
        this._plugins.runResolve(params);

        // Apply parameter overrides (post-resolution, post-plugin)
        this._applyOverridesToResult(params);

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
        // Server mode: return from cached server response
        if (this._options.evaluationMode === "server" && this._state.serverResponse) {
          const resp = this._state.serverResponse;
          const assignments = { ...options.defaults } as Record<string, ParameterValue>;
          for (const [key, value] of Object.entries(resp.assignments)) {
            if (key in assignments) {
              assignments[key] = value;
            }
          }
          const decision: DecisionResult = {
            decisionId: resp.decisionId,
            assignments,
            metadata: resp.metadata,
          };
          this._cacheDecision(decision);
          this._updateCumulativeAttribution(decision);
          this._plugins.runDecision(decision);
          this._applyOverridesToResult(decision.assignments);
          this._emitAssignmentLogEntries(decision);
          return decision;
        }

        const bundle = this._getEffectiveBundle();

        // Run plugin onBeforeDecision hooks
        let context = this._enrichContext(options.context);
        context = this._plugins.runBeforeDecision(context);

        // Pass cached edge results (from bundle mode pre-fetch) if available
        const edgeOpts = this._state.cachedEdgeResults ?? undefined;
        const decision = coreDecide<T>(bundle, context, options.defaults, edgeOpts);

        // Cache decision for attribution lookup when track() is called
        this._cacheDecision(decision);
        // Accumulate attribution entries (survives decision cache eviction)
        this._updateCumulativeAttribution(decision);

        // Run plugin onDecision hooks (e.g., DOM binding plugin)
        this._plugins.runDecision(decision);

        // Apply parameter overrides (post-resolution, post-plugin)
        this._applyOverridesToResult(decision.assignments);

        this._emitAssignmentLogEntries(decision);

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
   *
   * Skips layers marked `attributionOnly` — those were resolved for
   * attribution/assignment purposes only (no parameters were requested
   * from that layer) and should not count as exposures.
   */
  trackExposure(decision: DecisionResult): void {
    this._errorBoundary.capture(
      "trackExposure",
      () => {
        const unitKey = decision.metadata.unitKeyValue;
        if (!unitKey) return;

        // Emit to assignment logger (separate from cloud events)
        this._emitAssignmentLogEntries(decision);

        // Check each layer for deduplication
        for (const layer of decision.metadata.layers) {
          if (!layer.policyId || !layer.allocationName) continue;

          // Skip attribution-only layers — the user wasn't exposed to
          // parameters from this layer, so no exposure event should fire.
          if (layer.attributionOnly) continue;

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

          if (!this._disableCloudEvents) {
            this._eventLogger.log(event);
          }
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

        if (!this._disableCloudEvents) {
          this._eventLogger.log(event);
        }
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
   * If the client is already initialized, fires onInitialize and onConfigUpdate
   * immediately so late-registered plugins (e.g. debug plugin) work correctly.
   */
  use(plugin: TrafficalPlugin): this {
    const added = this._plugins.register(plugin);
    if (!added) return this;

    if (this._state.isInitialized) {
      try {
        plugin.onInitialize?.(this);
      } catch (error) {
        console.warn(`[Traffical] Plugin "${plugin.name}" late onInitialize error:`, error);
      }
      if (this._state.bundle) {
        try {
          plugin.onConfigUpdate?.(this._state.bundle);
        } catch (error) {
          console.warn(`[Traffical] Plugin "${plugin.name}" late onConfigUpdate error:`, error);
        }
      }
    }

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
   * Low-level — does NOT notify framework providers. Use `identify()` instead
   * when you want the UI to update.
   */
  setStableId(id: string): void {
    this._stableId.setId(id);
  }

  /**
   * Change the user identity and notify all listeners (framework providers,
   * plugins, DevTools). This causes React/Svelte/RN providers to re-evaluate
   * decisions with the new identity, updating the UI.
   *
   * @example
   * // After user logs in
   * client.identify('user_logged_in_123');
   */
  identify(unitKey: string): void {
    this._stableId.setId(unitKey);
    for (const cb of this._identityListeners) {
      try {
        cb(unitKey);
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Subscribe to identity changes triggered by `identify()`.
   * Returns an unsubscribe function.
   */
  onIdentityChange(cb: (unitKey: string) => void): () => void {
    this._identityListeners.push(cb);
    return () => {
      this._identityListeners = this._identityListeners.filter(l => l !== cb);
    };
  }

  // ===========================================================================
  // Parameter Overrides (Plugin API — not intended for direct public use)
  // ===========================================================================

  /**
   * Set parameter overrides. Only keys present in a decision's assignments
   * or getParams defaults will be overridden. Merges with existing overrides.
   *
   * Exposed via `PluginClientAPI` for debug tooling — not a public API.
   */
  applyOverrides(overrides: Record<string, ParameterValue>): void {
    Object.assign(this._overrides, overrides);
  }

  /**
   * Clear all parameter overrides.
   */
  clearOverrides(): void {
    this._overrides = {};
  }

  /**
   * Get a copy of the current overrides map.
   */
  getOverrides(): Record<string, ParameterValue> {
    return { ...this._overrides };
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private _emitAssignmentLogEntries(decision: DecisionResult): void {
    if (!this._assignmentLogger) return;
    const unitKey = decision.metadata.unitKeyValue;
    if (!unitKey) return;

    for (const layer of decision.metadata.layers) {
      if (!layer.policyId || !layer.allocationName) continue;

      // Dedup: skip if we've already logged this unit+policy+allocation in this session
      if (this._assignmentLoggerDedup) {
        const isNew = this._assignmentLoggerDedup.checkAndMark(unitKey, layer.policyId, layer.allocationName);
        if (!isNew) continue;
      }

      this._assignmentLogger({
        unitKey,
        policyId: layer.policyId,
        policyKey: layer.policyKey,
        allocationName: layer.allocationName,
        allocationKey: layer.allocationKey,
        timestamp: decision.metadata.timestamp,
        layerId: layer.layerId,
        allocationId: layer.allocationId,
        orgId: this._options.orgId,
        projectId: this._options.projectId,
        env: this._options.env,
        sdkName: SDK_NAME,
        sdkVersion: SDK_VERSION,
        properties: decision.metadata.filteredContext,
      });
    }
  }

  private _applyOverridesToResult(target: Record<string, ParameterValue>): void {
    const keys = Object.keys(this._overrides);
    if (keys.length === 0) return;
    for (const k of keys) {
      if (k in target) {
        target[k] = this._overrides[k];
      }
    }
  }

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

      // Pre-fetch edge results if bundle has edge-mode policies
      if (this._findEdgePolicies(bundle).length > 0) {
        const edgeResults = await this._prefetchEdgeResults(bundle, this._enrichContext({}));
        this._state.cachedEdgeResults = edgeResults;
      } else {
        this._state.cachedEdgeResults = null;
      }

      // Run plugin onConfigUpdate hooks (e.g., DOM binding plugin)
      this._plugins.runConfigUpdate(bundle);
    } catch (error) {
      this._logOfflineWarning(error);
    }
  }

  private _startBackgroundRefresh(): void {
    const interval = this._options.evaluationMode === "server"
      ? (this._state.serverResponse?.suggestedRefreshMs ?? this._options.refreshIntervalMs)
      : this._options.refreshIntervalMs;

    if (interval <= 0) return;

    this._state.refreshTimer = setInterval(() => {
      if (this._options.evaluationMode === "server") {
        this._fetchServerResolve().catch(() => {});
      } else {
        this._fetchConfig().catch(() => {});
      }
    }, interval);
  }

  private async _fetchServerResolve(): Promise<void> {
    if (!this._decisionClient) return;

    try {
      const context = this._enrichContext({});
      const response = await this._decisionClient.resolve({ context });
      if (response) {
        this._state.serverResponse = response;
        this._state.lastFetchTime = Date.now();
      }
    } catch (error) {
      this._logOfflineWarning(error);
    }
  }

  /**
   * Finds edge-mode policies in the current bundle.
   */
  private _findEdgePolicies(bundle: ConfigBundle): BundlePolicy[] {
    const policies: BundlePolicy[] = [];
    for (const layer of bundle.layers) {
      for (const policy of layer.policies) {
        if (
          policy.state === "running" &&
          policy.entityConfig?.resolutionMode === "edge"
        ) {
          policies.push(policy);
        }
      }
    }
    return policies;
  }

  /**
   * Pre-fetches edge results for edge-mode policies in bundle mode.
   * Returns ResolveOptions with edgeResults populated.
   */
  private async _prefetchEdgeResults(
    bundle: ConfigBundle,
    context: Context
  ): Promise<ResolveOptions> {
    if (!this._decisionClient) return {};

    const edgePolicies = this._findEdgePolicies(bundle);
    if (edgePolicies.length === 0) return {};

    const unitKeyValue = getUnitKeyValue(bundle, context);
    if (!unitKeyValue) return {};

    const requests = edgePolicies
      .map((policy) => {
        if (!policy.entityConfig) return null;
        const allocationCount = policy.entityConfig.dynamicAllocations
          ? (typeof context[policy.entityConfig.dynamicAllocations.countKey] === "number"
            ? Math.floor(context[policy.entityConfig.dynamicAllocations.countKey] as number)
            : 0)
          : policy.allocations.length;

        return createEdgeDecideRequest(
          policy.id,
          policy.entityConfig.entityKeys,
          context,
          unitKeyValue,
          allocationCount || undefined
        );
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (requests.length === 0) return {};

    try {
      const responses = await this._decisionClient.decideEntityBatch(requests);
      const edgeResults = new Map<string, { allocationIndex: number; entityId: string }>();

      for (let i = 0; i < requests.length; i++) {
        const resp = responses[i];
        if (resp) {
          edgeResults.set(requests[i].policyId, {
            allocationIndex: resp.allocationIndex,
            entityId: requests[i].entityId,
          });
        }
      }

      return edgeResults.size > 0 ? { edgeResults } : {};
    } catch {
      return {};
    }
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
   * Accumulates attribution entries from a decision into the session-level map.
   * Keyed by unitKey → layerId:policyId with last-write-wins semantics.
   * This ensures attribution survives decision cache eviction.
   */
  private _updateCumulativeAttribution(decision: DecisionResult): void {
    const unitKey = decision.metadata.unitKeyValue;
    if (!unitKey) return;

    let userAttrs = this._cumulativeAttribution.get(unitKey);
    if (!userAttrs) {
      userAttrs = new Map<string, TrackAttribution>();
      this._cumulativeAttribution.set(unitKey, userAttrs);
    }

    for (const l of decision.metadata.layers) {
      if (!l.policyId || !l.allocationName) continue;
      const key = `${l.layerId}:${l.policyId}`;
      // Last-write-wins: later decisions overwrite earlier ones.
      // For per-entity dynamic allocation policies this keeps only the most
      // recent allocation; for normal policies allocationName is deterministic
      // so the overwrite is a no-op.
      userAttrs.set(key, {
        layerId: l.layerId,
        policyId: l.policyId,
        allocationName: l.allocationName,
      });
    }
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

    // Cumulative mode: use the pre-built cumulative attribution map.
    // This map accumulates entries from ALL decide() calls for this unit during
    // the session, deduplicated by layerId:policyId (last-write-wins).
    // Unlike iterating _decisionCache, this is immune to cache eviction —
    // e.g. when per-entity OptimizedProductCard decisions push out earlier
    // page-level decisions that contain important layer assignments.
    const userAttrs = this._cumulativeAttribution.get(unitKey);
    return userAttrs && userAttrs.size > 0
      ? Array.from(userAttrs.values())
      : undefined;
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

