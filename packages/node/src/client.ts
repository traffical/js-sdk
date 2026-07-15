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
  type LayerResolution,
  type ParameterValue,
  type TrafficalClientOptions as CoreClientOptions,
  type TrackOptions,
  type TrackEventOptions,
  type DecideOptions,
  type GetParamsOptions,
  type ExposureEvent,
  type TrackEvent,
  type TrackAttribution,
  type DecisionEvent,
  type ServerResolveResponse,
  type AssignmentLogger,
  type AssignmentType,
  type TrackableEvent,
  type TrackableEventLogger,
  type TrackEventMap,
  type OnSchemaWarnings,
  resolveParameters,
  decide as coreDecide,
  getUnitKeyField as coreGetUnitKeyField,
  getParameterLayerId as coreGetParameterLayerId,
  DecisionDeduplicator,
  generateExposureId,
  generateTrackEventId,
  generateAssignmentId,
  generateDecisionId,
} from "@traffical/core";

import { DecisionClient } from "@traffical/core-io";

import { EventBatcher } from "./event-batcher.js";
import { SDK_VERSION } from "./version.js";

// =============================================================================
// Constants
// =============================================================================

const SDK_NAME = "node";

/**
 * Normalizes evaluation-method arguments so both the canonical positional form
 * `decide(context, defaults)` and the legacy object-bag form
 * `decide({ context, defaults })` work. Positional is detected by the presence
 * of the second (`defaults`) argument; the bag form is soft-deprecated.
 */
function normalizeEvalArgs<T extends Record<string, ParameterValue>>(
  contextOrOptions: Context | { context: Context; defaults: T },
  maybeDefaults?: T
): { context: Context; defaults: T } {
  if (maybeDefaults !== undefined) {
    return { context: contextOrOptions as Context, defaults: maybeDefaults };
  }
  const bag = contextOrOptions as { context: Context; defaults: T };
  return { context: bag.context, defaults: bag.defaults };
}

const DEFAULT_BASE_URL = "https://sdk.traffical.io";
const DEFAULT_REFRESH_INTERVAL_MS = 60_000; // 1 minute
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000; // 10 seconds
const OFFLINE_WARNING_INTERVAL_MS = 300_000; // 5 minutes
const MALFORMED_BUNDLE_WARNING_INTERVAL_MS = 300_000; // 5 minutes
const DECISION_CACHE_MAX_SIZE = 1000; // Max decisions to cache for attribution lookup
/** +/-10% jitter on the background refresh interval to avoid thundering-herd sync. */
const REFRESH_JITTER_RATIO = 0.1;
const ASSIGNMENT_LOGGER_LRU_MAX = 10_000;
const ASSIGNMENT_LOGGER_LRU_TTL_MS = 60 * 60 * 1000; // 1 hour
const EXPOSURE_DEDUP_LRU_MAX = 10_000;
const DEFAULT_EXPOSURE_SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes (mirrors js-client)

/** Returns `intervalMs` perturbed by uniform +/-REFRESH_JITTER_RATIO jitter. */
function jitteredInterval(intervalMs: number): number {
  const delta = intervalMs * REFRESH_JITTER_RATIO;
  return intervalMs + (Math.random() * 2 - 1) * delta;
}

/**
 * Structural guard for a fetched config bundle. A 200 response can still carry a
 * malformed body (truncated CDN write, partial deploy); serving it would corrupt
 * every bucket assignment. Requires the hashing config the resolver depends on
 * (`unitKey` non-empty, `bucketCount` an integer >= 1) plus the top-level
 * parameters/layers arrays.
 */
function isValidConfigBundle(bundle: unknown): bundle is ConfigBundle {
  if (!bundle || typeof bundle !== "object") return false;
  const b = bundle as Partial<ConfigBundle>;
  if (!Array.isArray(b.parameters)) return false;
  if (!Array.isArray(b.layers)) return false;
  const hashing = b.hashing as Partial<ConfigBundle["hashing"]> | undefined;
  if (!hashing || typeof hashing !== "object") return false;
  if (typeof hashing.unitKey !== "string" || hashing.unitKey.length === 0) return false;
  if (
    typeof hashing.bucketCount !== "number" ||
    !Number.isInteger(hashing.bucketCount) ||
    hashing.bucketCount < 1
  ) {
    return false;
  }
  return true;
}

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
   * @deprecated Use the canonical `batchSize` instead. `eventBatchSize` still works.
   */
  eventBatchSize?: number;
  /**
   * Event flush interval in milliseconds (default: 30000).
   * @deprecated Use the canonical `flushIntervalMs` instead. `eventFlushIntervalMs` still works.
   */
  eventFlushIntervalMs?: number;
  /** Events per delivery batch (default: 10). Canonical alias of `eventBatchSize`. */
  batchSize?: number;
  /** Event flush cadence in milliseconds (default: 30000). Canonical alias of `eventFlushIntervalMs`. */
  flushIntervalMs?: number;
  /**
   * Maximum number of events buffered in memory before the oldest is dropped
   * (default: 1000). Bounds memory in long-lived server processes.
   */
  eventMaxQueueSize?: number;
  /**
   * Timeout in milliseconds for SDK network requests — the config bundle
   * fetch and event batch POSTs (default: 10000).
   *
   * On timeout the request is aborted and treated exactly like a network
   * failure: config fetches fall back to the cached/local config, and event
   * batches are re-queued for retry.
   *
   * @deprecated Use the per-path options `configTimeoutMs`, `eventsTimeoutMs`,
   * and `resolveTimeoutMs` instead. `requestTimeoutMs` is still honored as the
   * legacy fallback for all three when the specific option is not provided.
   */
  requestTimeoutMs?: number;
  /**
   * Timeout in milliseconds for the config-bundle fetch (default: 10000).
   * Falls back to `requestTimeoutMs` when not set.
   */
  configTimeoutMs?: number;
  /**
   * Timeout in milliseconds for event-delivery POSTs (default: 10000).
   * Falls back to `requestTimeoutMs` when not set.
   */
  eventsTimeoutMs?: number;
  /**
   * Timeout in milliseconds for server-resolve requests (POST /v1/resolve,
   * default: 5000). Falls back to `requestTimeoutMs` when not set.
   */
  resolveTimeoutMs?: number;
  /**
   * Enable debug logging for events (default: false).
   */
  debugEvents?: boolean;
  /**
   * Evaluation mode (default: "bundle").
   * - "bundle": SDK fetches config bundle, resolves parameters locally.
   * - "server": SDK delegates resolution to the edge worker via POST /v1/resolve.
   */
  evaluationMode?: "bundle" | "server";

  /**
   * Optional callback for routing assignment events to a customer-managed
   * pipeline (e.g., Segment, Rudderstack, direct DB writes).
   */
  assignmentLogger?: AssignmentLogger;

  /**
   * When true, the SDK will NOT send events to the Traffical control plane.
   * Default: false
   */
  disableCloudEvents?: boolean;

  /**
   * When true, assignment logger calls are deduplicated via in-memory LRU
   * (same unit+policy+variant won't fire again within TTL). Default: true.
   */
  deduplicateAssignmentLogger?: boolean;

  /**
   * When true, exposure events are deduplicated per (unit, policy, allocation)
   * within a session via in-memory LRU, mirroring the browser SDK. Default: true.
   */
  deduplicateExposures?: boolean;

  /**
   * Exposure deduplication session TTL in milliseconds (default: 30 minutes).
   */
  exposureSessionTtlMs?: number;

  /**
   * Optional callback for routing full events (exposure, track, decision)
   * to a customer-managed pipeline (e.g. Jitsu, Segment). Fires regardless
   * of disableCloudEvents, so you can send to your own sink instead of (or
   * in addition to) the Traffical edge.
   */
  eventLogger?: TrackableEventLogger;

  /**
   * Callback for schema validation warnings from the edge.
   * Only fires when event schemas are defined and enforcement is "warn".
   * Recommended for development builds to surface schema violations.
   */
  onSchemaWarnings?: OnSchemaWarnings;
}

// =============================================================================
// Client State
// =============================================================================

interface ClientState {
  bundle: ConfigBundle | null;
  etag: string | null;
  lastFetchTime: number;
  lastOfflineWarning: number;
  lastMalformedWarning: number;
  refreshTimer: ReturnType<typeof setInterval> | null;
  isInitialized: boolean;
  serverResponse: ServerResolveResponse | null;
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
export class TrafficalClient<TEvents extends TrackEventMap = TrackEventMap> {
  private readonly _options: Required<
    Pick<
      TrafficalClientOptions,
      "orgId" | "projectId" | "env" | "apiKey" | "baseUrl" | "refreshIntervalMs" | "strictMode"
    >
  > & {
    localConfig?: ConfigBundle;
    trackDecisions: boolean;
    evaluationMode: "bundle" | "server";
  };

  private _state: ClientState = {
    bundle: null,
    etag: null,
    lastFetchTime: 0,
    lastOfflineWarning: 0,
    lastMalformedWarning: 0,
    refreshTimer: null,
    isInitialized: false,
    serverResponse: null,
  };

  private readonly _eventBatcher: EventBatcher;
  private readonly _requestTimeoutMs: number;
  private readonly _decisionDedup: DecisionDeduplicator;
  private readonly _decisionClient: DecisionClient;
  private readonly _assignmentLogger?: AssignmentLogger;
  private readonly _byoEventLogger?: TrackableEventLogger;
  private readonly _disableCloudEvents: boolean;
  /** In-memory LRU for assignment logger deduplication: key → expiry timestamp */
  private readonly _assignmentLoggerDedup: Map<string, number> | null;
  /** In-memory LRU for exposure-event deduplication: key → expiry timestamp */
  private readonly _exposureDedup: Map<string, number> | null;
  /** Session TTL for exposure deduplication (ms) */
  private readonly _exposureSessionTtlMs: number;
  /** Cache of recent decisions for attribution lookup on rewards */
  private readonly _decisionCache: Map<string, DecisionResult> = new Map();
  /** Serialized context of the last server-mode resolve (per-call throttle). */
  private _lastResolveContextKey: string | null = null;
  /** Resolves once the first config load attempt completes (fail-open). */
  private _readyResolve!: () => void;
  private readonly _readyPromise: Promise<void> = new Promise((resolve) => {
    this._readyResolve = resolve;
  });

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
      trackDecisions: options.trackDecisions !== false,
      evaluationMode: options.evaluationMode ?? "bundle",
    };
    // Config-fetch timeout: canonical configTimeoutMs wins, else legacy requestTimeoutMs.
    this._requestTimeoutMs =
      options.configTimeoutMs ?? options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

    // Initialize DecisionClient
    this._decisionClient = new DecisionClient({
      baseUrl: this._options.baseUrl,
      orgId: this._options.orgId,
      projectId: this._options.projectId,
      env: this._options.env,
      apiKey: this._options.apiKey,
      // Server-resolve timeout: canonical resolveTimeoutMs wins, else legacy
      // requestTimeoutMs; undefined lets DecisionClient apply its own 5s default.
      defaultTimeoutMs: options.resolveTimeoutMs ?? options.requestTimeoutMs,
    });

    // Default dev-mode schema warnings handler
    if (!options.onSchemaWarnings && typeof process !== "undefined" && process.env?.NODE_ENV === "development") {
      options.onSchemaWarnings = (warnings) => {
        for (const w of warnings) {
          console.warn(
            `[Traffical] Schema warning for "${w.event}":`,
            w.violations.map(v => `${v.path}: ${v.message}`).join(", ")
          );
        }
      };
    }

    // Initialize event batcher
    this._eventBatcher = new EventBatcher({
      endpoint: `${this._options.baseUrl}/v1/events/batch`,
      apiKey: options.apiKey,
      // Canonical batchSize/flushIntervalMs win over legacy event* names.
      batchSize: options.batchSize ?? options.eventBatchSize,
      flushIntervalMs: options.flushIntervalMs ?? options.eventFlushIntervalMs,
      maxQueueSize: options.eventMaxQueueSize,
      // Event-delivery timeout: canonical eventsTimeoutMs wins, else legacy requestTimeoutMs.
      requestTimeoutMs: options.eventsTimeoutMs ?? options.requestTimeoutMs,
      debug: options.debugEvents,
      onError: (error) => {
        console.warn(`[Traffical] Event batching error: ${error.message}`);
      },
      onSchemaWarnings: options.onSchemaWarnings,
    });

    // Initialize decision deduplicator
    this._decisionDedup = new DecisionDeduplicator({
      ttlMs: options.decisionDeduplicationTtlMs,
    });

    // Warehouse-native options
    this._assignmentLogger = options.assignmentLogger;
    this._byoEventLogger = options.eventLogger;
    this._disableCloudEvents = options.disableCloudEvents ?? false;
    this._assignmentLoggerDedup = (options.deduplicateAssignmentLogger !== false && options.assignmentLogger)
      ? new Map<string, number>()
      : null;
    this._exposureDedup = options.deduplicateExposures !== false ? new Map<string, number>() : null;
    this._exposureSessionTtlMs = options.exposureSessionTtlMs ?? DEFAULT_EXPOSURE_SESSION_TTL_MS;

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
    if (this._options.evaluationMode === "server") {
      await this._fetchServerResolve({});
    } else {
      await this._fetchConfig();
    }
    this._startBackgroundRefresh();
    this._state.isInitialized = true;
    this._readyResolve();
  }

  /**
   * Resolves once the first usable config has loaded (or the SDK has failed
   * open on an unavailable/malformed bundle). Never rejects.
   */
  async waitForReady(): Promise<void> {
    return this._readyPromise;
  }

  /**
   * Single teardown verb (spec 0.7.0 design contract). Stops background
   * refresh and awaits a final event flush before returning.
   */
  async close(): Promise<void> {
    await this.destroy();
  }

  /**
   * Stops background refresh and cleans up resources.
   *
   * @deprecated Use {@link close} instead — the canonical single teardown verb.
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
   *
   * @deprecated Use {@link close} instead. This best-effort variant does not
   * await the final flush; prefer `await close()` where you can.
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
    if (this._options.evaluationMode === "server") {
      await this._fetchServerResolve({});
    } else {
      await this._fetchConfig();
    }
  }

  /**
   * Gets the current config bundle version.
   */
  getConfigVersion(): string | null {
    return this._state.serverResponse?.stateVersion ?? this._state.bundle?.version ?? null;
  }

  /**
   * Returns the context field the bundle buckets on (the project's unit key),
   * or null before the bundle has loaded. Adapters (e.g. an OpenFeature
   * provider) map their targeting key onto this field.
   */
  getUnitKeyField(): string | null {
    return coreGetUnitKeyField(this._getEffectiveBundle());
  }

  /**
   * Returns the id of the layer a parameter belongs to, or null if the
   * parameter is unknown / the bundle is not yet loaded.
   */
  getParameterLayerId(key: string): string | null {
    return coreGetParameterLayerId(this._getEffectiveBundle(), key);
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
  getParams<T extends Record<string, ParameterValue>>(context: Context, defaults: T): T;
  /** @deprecated Pass `(context, defaults)` positionally (spec 0.7.0 contract). */
  getParams<T extends Record<string, ParameterValue>>(options: GetParamsOptions<T>): T;
  getParams<T extends Record<string, ParameterValue>>(
    contextOrOptions: Context | GetParamsOptions<T>,
    maybeDefaults?: T
  ): T {
    const { context, defaults } = normalizeEvalArgs<T>(contextOrOptions, maybeDefaults);

    // Server mode: return from cached server response
    if (this._options.evaluationMode === "server" && this._state.serverResponse) {
      // Thread THIS call's context into a per-call resolve so the cached
      // snapshot converges to the context actually being evaluated (server
      // mode can't block a sync getParams() on the network; degrade to the
      // last-good snapshot for the current call).
      this._maybeResolveForContext(context);
      const result = { ...defaults } as Record<string, ParameterValue>;
      for (const [key, value] of Object.entries(this._state.serverResponse.assignments)) {
        if (key in result) {
          result[key] = value;
        }
      }
      return result as T;
    }

    const bundle = this._getEffectiveBundle();
    return resolveParameters<T>(bundle, context, defaults);
  }

  /**
   * Makes a decision with full metadata for tracking.
   *
   * When trackDecisions is enabled (default), automatically sends a DecisionEvent
   * to the backend for intent-to-treat analysis.
   */
  decide<T extends Record<string, ParameterValue>>(context: Context, defaults: T): DecisionResult;
  /** @deprecated Pass `(context, defaults)` positionally (spec 0.7.0 contract). */
  decide<T extends Record<string, ParameterValue>>(options: DecideOptions<T>): DecisionResult;
  decide<T extends Record<string, ParameterValue>>(
    contextOrOptions: Context | DecideOptions<T>,
    maybeDefaults?: T
  ): DecisionResult {
    const start = Date.now();
    const { context, defaults } = normalizeEvalArgs<T>(contextOrOptions, maybeDefaults);

    // Server mode: return from cached server response
    if (this._options.evaluationMode === "server" && this._state.serverResponse) {
      // Thread THIS call's context into a per-call resolve so the snapshot
      // converges to the evaluated context (sync decide() can't block on the
      // network; degrade to the last-good snapshot for the current call).
      this._maybeResolveForContext(context);
      const resp = this._state.serverResponse;
      const assignments = { ...defaults } as Record<string, ParameterValue>;
      for (const [key, value] of Object.entries(resp.assignments)) {
        if (key in assignments) {
          assignments[key] = value;
        }
      }
      const decision: DecisionResult = {
        // Mint a FRESH decisionId per call — never reuse the resolve
        // response's decisionId across decisions (each decide() is a distinct
        // decision for attribution).
        decisionId: generateDecisionId(),
        assignments,
        // Snapshot the resolve stateVersion at decision time so events
        // built later stamp the version this decision was evaluated
        // against (not whatever response is cached at event-build time).
        metadata: { ...resp.metadata, configVersion: resp.stateVersion },
      };
      this._cacheDecision(decision);
      if (this._options.trackDecisions) {
        this._trackDecision(decision, Date.now() - start, Object.keys(defaults));
      }
      this._emitAssignmentLogEntries(decision, "decision");
      return decision;
    }

    const bundle = this._getEffectiveBundle();
    const decision = coreDecide<T>(bundle, context, defaults);
    const latencyMs = Date.now() - start;

    this._cacheDecision(decision);

    if (this._options.trackDecisions) {
      this._trackDecision(decision, latencyMs, Object.keys(defaults));
    }

    this._emitAssignmentLogEntries(decision, "decision");

    return decision;
  }

  /**
   * Tracks an exposure event — the "user was actually shown this treatment"
   * signal (treatment-on-the-treated).
   *
   * Only layers the caller was actually exposed to are emitted: layers without
   * a policy/allocation and `attributionOnly` layers (resolved for attribution
   * but whose parameters weren't requested) are skipped, and each
   * (unit, policy, allocation) is deduplicated per session so the same exposure
   * isn't emitted twice. Mirrors the browser SDK. If the decision includes
   * filtered context (from policies with contextLogging), it is included in the
   * exposure event for contextual bandit training.
   */
  trackExposure(decision: DecisionResult): void {
    const unitKey = decision.metadata.unitKeyValue;
    if (!unitKey) {
      return;
    }

    // Emit to assignment logger (separate from cloud events; has its own dedup)
    this._emitAssignmentLogEntries(decision, "exposure");

    // Exposure layers = layers actually shown. Skip attribution-only layers and
    // layers without a policy/allocation, and dedup per (unit, policy,
    // allocation) within the session.
    const now = Date.now();
    const exposedLayers: LayerResolution[] = [];
    for (const layer of decision.metadata.layers) {
      if (!layer.policyId || !layer.allocationName) continue;
      if (layer.attributionOnly) continue;

      if (this._exposureDedup) {
        const dedupKey = `${unitKey}:${layer.policyId}:${layer.allocationName}`;
        const expiry = this._exposureDedup.get(dedupKey);
        if (expiry !== undefined && now < expiry) continue;

        // Evict oldest entry when the LRU is full.
        if (this._exposureDedup.size >= EXPOSURE_DEDUP_LRU_MAX) {
          const firstKey = this._exposureDedup.keys().next().value;
          if (firstKey) this._exposureDedup.delete(firstKey);
        }
        this._exposureDedup.set(dedupKey, now + this._exposureSessionTtlMs);
      }

      exposedLayers.push(layer);
    }

    // Nothing new to expose (all attribution-only or already seen this session).
    if (exposedLayers.length === 0) {
      return;
    }

    const event: ExposureEvent = {
      type: "exposure",
      id: generateExposureId(),
      decisionId: decision.decisionId,
      orgId: this._options.orgId,
      projectId: this._options.projectId,
      env: this._options.env,
      unitKey,
      timestamp: new Date().toISOString(),
      assignments: decision.assignments,
      layers: exposedLayers,
      context: decision.metadata.filteredContext,
      // Config bundle version the SDK evaluated against — from the
      // decision-time snapshot. The current version is only a fallback for
      // decisions that predate the snapshot field.
      configVersion:
        decision.metadata.configVersion ?? this.getConfigVersion() ?? undefined,
      sdkName: SDK_NAME,
      sdkVersion: SDK_VERSION,
    };

    this._dispatchEvent(event);
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
  track<E extends Extract<keyof TEvents, string>>(
    event: E,
    properties?: TEvents[E],
    options?: TrackEventOptions
  ): void {
    // Single numeric value: explicit options.value wins, else properties.value.
    const value =
      typeof options?.value === "number"
        ? options.value
        : typeof properties?.value === "number"
          ? properties.value
          : undefined;

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
      values: options?.values,
      properties,
      decisionId: options?.decisionId,
      attribution,
      eventTimestamp: options?.eventTimestamp,
      sdkName: SDK_NAME,
      sdkVersion: SDK_VERSION,
    };

    this._dispatchEvent(trackEvent);
  }

  /**
   * @deprecated Use track() instead.
   * Tracks a reward event.
   * If decisionId is provided and the decision is cached, attribution is auto-populated.
   */
  trackReward(options: TrackOptions): void {
    // Forward the value and decisionId (previously dropped) plus any secondary
    // values, so rewards still carry their optimization signal + attribution.
    (this.track as (
      event: string,
      properties?: Record<string, unknown>,
      options?: TrackEventOptions
    ) => void)(options.event, options.properties, {
      decisionId: options.decisionId,
      value: options.value,
      values: options.values,
    });
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private _emitAssignmentLogEntries(decision: DecisionResult, type: AssignmentType): void {
    if (!this._assignmentLogger) return;
    const unitKey = decision.metadata.unitKeyValue;
    if (!unitKey) return;

    // Config bundle version the SDK evaluated against — from the
    // decision-time snapshot, falling back to the current version.
    const configVersion =
      decision.metadata.configVersion ?? this.getConfigVersion() ?? undefined;

    const now = Date.now();

    for (const layer of decision.metadata.layers) {
      if (!layer.policyId || !layer.allocationName) continue;

      if (this._assignmentLoggerDedup) {
        const dedupKey = `${unitKey}:${layer.policyId}:${layer.allocationName}:${type}`;
        const expiry = this._assignmentLoggerDedup.get(dedupKey);
        if (expiry !== undefined && now < expiry) continue;

        // Evict oldest entries when LRU is full
        if (this._assignmentLoggerDedup.size >= ASSIGNMENT_LOGGER_LRU_MAX) {
          const firstKey = this._assignmentLoggerDedup.keys().next().value;
          if (firstKey) this._assignmentLoggerDedup.delete(firstKey);
        }
        this._assignmentLoggerDedup.set(dedupKey, now + ASSIGNMENT_LOGGER_LRU_TTL_MS);
      }

      this._assignmentLogger({
        unitKey,
        policyId: layer.policyId,
        allocationName: layer.allocationName,
        timestamp: decision.metadata.timestamp,
        layerId: layer.layerId,
        allocationId: layer.allocationId,
        orgId: this._options.orgId,
        projectId: this._options.projectId,
        env: this._options.env,
        sdkName: SDK_NAME,
        sdkVersion: SDK_VERSION,
        properties: decision.metadata.filteredContext,
        type,
        decisionId: decision.decisionId,
        anonymousId: undefined,
        id: generateAssignmentId(),
        bucket: layer.bucket >= 0 ? layer.bucket : undefined,
        probability: layer.probability,
        modelVersion: layer.modelVersion,
        configVersion,
      });
    }
  }

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
    // URL-encode path/query components so an env or projectId containing
    // reserved characters (spaces, &, ?, /) can't corrupt the request URL.
    const url = `${this._options.baseUrl}/v1/config/${encodeURIComponent(
      this._options.projectId
    )}?env=${encodeURIComponent(this._options.env)}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this._options.apiKey}`,
    };

    // Add ETag for conditional request
    if (this._state.etag) {
      headers["If-None-Match"] = this._state.etag;
    }

    // Abort the request if the edge hangs (slow TCP, not a 5xx) so the
    // promise settles and we fall back to cached/local config.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this._requestTimeoutMs);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });

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

      // A 200 can still carry a malformed body. Discard it and keep the
      // previous last-good bundle rather than corrupting bucket assignments or
      // falling through to defaults when we already have a valid config.
      if (!isValidConfigBundle(bundle)) {
        this._logMalformedBundleWarning();
        return;
      }

      this._state.bundle = bundle;
      this._state.etag = etag;
      this._state.lastFetchTime = Date.now();
    } catch (error) {
      this._logOfflineWarning(error);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Starts background refresh timer.
   */
  private _startBackgroundRefresh(): void {
    const interval = this._options.evaluationMode === "server"
      ? (this._state.serverResponse?.suggestedRefreshMs ?? this._options.refreshIntervalMs)
      : this._options.refreshIntervalMs;

    if (interval <= 0) return;

    // Reschedule via setTimeout with fresh +/-10% jitter each tick (instead of a
    // fixed setInterval) so fleets of clients don't converge on the same refresh
    // instant and stampede the edge.
    const scheduleNext = () => {
      this._state.refreshTimer = setTimeout(() => {
        // Schedule the next tick before firing so cadence stays independent of
        // fetch latency (matching the previous fire-and-forget setInterval).
        scheduleNext();
        if (this._options.evaluationMode === "server") {
          this._fetchServerResolve({}).catch(() => {});
        } else {
          this._fetchConfig().catch(() => {});
        }
      }, jitteredInterval(interval));

      // Unref so timer doesn't keep process alive
      if (this._state.refreshTimer && typeof this._state.refreshTimer.unref === "function") {
        this._state.refreshTimer.unref();
      }
    };
    scheduleNext();
  }

  /**
   * Logs an offline warning (rate-limited).
   */
  /**
   * Server mode: threads the per-call context into a background /v1/resolve so
   * the cached snapshot converges to the contexts actually being evaluated.
   * Throttled by serialized context so repeated identical contexts (the common
   * case) don't hammer the edge. Because decide()/getParams() are synchronous
   * they cannot await this; the current call degrades to the last-good snapshot
   * and subsequent calls pick up the refreshed resolution.
   */
  private _maybeResolveForContext(context: Context): void {
    let key: string;
    try {
      key = JSON.stringify(context);
    } catch {
      key = "";
    }
    if (key === this._lastResolveContextKey) return;
    this._lastResolveContextKey = key;
    void this._fetchServerResolve(context);
  }

  private async _fetchServerResolve(context: Context): Promise<void> {
    try {
      const response = await this._decisionClient.resolve({ context });
      if (response) {
        this._state.serverResponse = response;
        this._state.lastFetchTime = Date.now();
      }
    } catch (error) {
      this._logOfflineWarning(error);
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

  private _logMalformedBundleWarning(): void {
    const now = Date.now();
    if (now - this._state.lastMalformedWarning > MALFORMED_BUNDLE_WARNING_INTERVAL_MS) {
      console.warn(
        `[Traffical] Discarded malformed config bundle (invalid hashing/shape). Using ${this._state.bundle ? "cached" : "local"} config.`
      );
      this._state.lastMalformedWarning = now;
    }
  }

  /**
   * Routes a built event to the BYO event logger (if configured) and to the
   * Traffical edge batcher (unless cloud events are disabled).
   */
  private _dispatchEvent(event: TrackableEvent): void {
    if (this._byoEventLogger) {
      try {
        this._byoEventLogger(event);
      } catch {
        // Swallow BYO logger errors — they must not break SDK event handling.
      }
    }
    if (!this._disableCloudEvents) {
      this._eventBatcher.log(event);
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
    if (this._disableCloudEvents && !this._byoEventLogger) return;

    const unitKey = decision.metadata.unitKeyValue;
    if (!unitKey) {
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
      // Config bundle version the SDK evaluated against — from the
      // decision-time snapshot, falling back to the current version.
      configVersion:
        decision.metadata.configVersion ?? this.getConfigVersion() ?? undefined,
      sdkName: SDK_NAME,
      sdkVersion: SDK_VERSION,
    };

    this._dispatchEvent(event);
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
export async function createTrafficalClient<TEvents extends TrackEventMap = TrackEventMap>(
  options: TrafficalClientOptions
): Promise<TrafficalClient<TEvents>> {
  const client = new TrafficalClient<TEvents>(options);
  await client.initialize();
  return client;
}

/**
 * Creates a Traffical client without initializing (synchronous).
 * Useful when you want to control initialization timing.
 */
export function createTrafficalClientSync<TEvents extends TrackEventMap = TrackEventMap>(
  options: TrafficalClientOptions
): TrafficalClient<TEvents> {
  return new TrafficalClient<TEvents>(options);
}

