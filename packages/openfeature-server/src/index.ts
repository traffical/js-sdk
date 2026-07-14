/**
 * @traffical/openfeature-server
 *
 * OpenFeature SERVER (dynamic-context) provider backed by a Traffical Node
 * client. Combines the resolve path (M1) with the exposure / reward / lifecycle
 * path (M2).
 *
 * Design: see the OpenFeature provider design in the Traffical SDK spec.
 *   §2 architecture · §3 core mapping · §4 resolution · §5 exposure ·
 *   §6 reward · §7 lifecycle/events · §8 server provider · §10 SDK enhancements ·
 *   §11 testing · §13 measurement fidelity.
 *
 * The provider is a thin translation membrane over the native client, with one
 * piece of genuine state: a request-scoped decision store (AsyncLocalStorage)
 * that lets the explicit exposure/reward calls find the decision the caller
 * actually saw — WITHOUT ever re-deciding (design §5, D3/A2).
 */

import { AsyncLocalStorage } from "node:async_hooks";

import {
  ErrorCode,
  OpenFeatureEventEmitter,
  ProviderEvents,
  ProviderFatalError,
} from "@openfeature/server-sdk";
import type {
  EvaluationContext,
  JsonValue,
  Logger,
  Paradigm,
  Provider,
  ResolutionDetails,
  Tracking,
  TrackingEventDetails,
} from "@openfeature/server-sdk";

import {
  EXPOSURE_EVENT_NAME,
  buildTrafficalContext,
  toResolutionDetails,
} from "@traffical/openfeature-core";
import type {
  OFFlagType,
  TrafficalClientLike,
  TrafficalProviderOptions,
} from "@traffical/openfeature-core";
import type { DecisionResult, ParameterValue } from "@traffical/core";

// -----------------------------------------------------------------------------
// Client shape
// -----------------------------------------------------------------------------

/**
 * The `TrafficalClientLike` structural surface plus the OPTIONAL lifecycle
 * methods the provider feature-detects. The concrete `@traffical/node`
 * `TrafficalClient` satisfies this shape (it has `initialize`, `flushEvents`,
 * and `destroy`), but tests can inject a leaner stub.
 */
export interface TrafficalServerClient extends TrafficalClientLike {
  initialize?(): Promise<void>;
  flushEvents?(): Promise<void>;
  destroy?(): Promise<void> | void;
  /**
   * Optional accessor some clients expose for the configured evaluation mode.
   * v1 supports `"bundle"` only (design §7.4); a `"server"`-mode client is
   * warned about because it resolves with an empty context.
   */
  getEvaluationMode?(): "bundle" | "server" | undefined;
}

// -----------------------------------------------------------------------------
// Fallback store (used only when there is NO active request store)
// -----------------------------------------------------------------------------

/** How long a fallback decision lives when no request store is active. */
const FALLBACK_TTL_MS = 60_000;
/** Max entries in the fallback LRU before oldest entries are evicted. */
const FALLBACK_MAX = 2000;
/** How many decisions may accumulate before the no-exposure alarm can fire. */
const ALARM_DECISION_THRESHOLD = 20;

interface FallbackEntry {
  decision: DecisionResult;
  expiry: number;
}

// -----------------------------------------------------------------------------
// Provider
// -----------------------------------------------------------------------------

/**
 * OpenFeature server provider for Traffical.
 *
 * Wrap each request in {@link TrafficalServerProvider.runInRequest} so that
 * `resolve`, the explicit `$traffical.exposure` `track()`, and reward `track()`
 * calls all share one request-scoped decision store — this is what makes
 * exposure/reward find the exact decision the caller saw without re-deciding,
 * and prevents cross-unit bleed under concurrency (design §8).
 */
export class TrafficalServerProvider implements Provider, Tracking {
  public readonly metadata = { name: "traffical-provider" } as const;

  /** The SDK enforces this at runtime to prevent paradigm mismatch (design §7.1). */
  public readonly runsOn: Paradigm = "server";

  /** The provider owns its event emitter — the SDK won't synthesize events. */
  public readonly events = new OpenFeatureEventEmitter();

  /** No provider hooks; exposure is an explicit render-time signal (design §5). */
  public readonly hooks = [];

  private readonly client: TrafficalServerClient;
  private readonly options: TrafficalProviderOptions;

  /**
   * Request-scoped decision store: flagKey → the decision made for it this
   * request. The single source of truth for exposure/reward stitching (§4.2/§8).
   */
  private readonly als = new AsyncLocalStorage<Map<string, DecisionResult>>();

  /**
   * Bounded fallback used ONLY when there is no active request store, keyed by
   * `unitKeyValue + ":" + flagKey`. Safe-to-miss; a miss warns once and no-ops.
   */
  private readonly fallback = new Map<string, FallbackEntry>();

  // Observability counters for the no-exposure alarm (design §5, D2).
  private decisionsEmitted = 0;
  private exposuresEmitted = 0;
  private alarmed = false;

  // One-time warning guards.
  private warnedNoStore = false;
  private warnedExposureMiss = false;

  // Lifecycle guards (idempotency).
  private initialized = false;
  private closed = false;

  constructor(client: TrafficalServerClient, options?: TrafficalProviderOptions) {
    this.client = client;
    this.options = options ?? {};
  }

  // ---------------------------------------------------------------------------
  // Request scope
  // ---------------------------------------------------------------------------

  /**
   * Runs `fn` inside a fresh per-request decision store. The app SHOULD wrap
   * each request with this so resolve, exposure and reward share one store
   * (design §8). Without it, the provider falls back to a bounded, TTL'd LRU
   * and warns once.
   */
  runInRequest<TArgs extends unknown[], R>(fn: (...args: TArgs) => R, ...args: TArgs): R {
    return this.als.run(new Map<string, DecisionResult>(), fn, ...args);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async initialize(_context?: EvaluationContext): Promise<void> {
    // Guard double-init: the SDK only calls initialize when NOT_READY, but the
    // caller may have already initialized the injected client.
    if (this.initialized) return;

    // v1 supports "bundle" mode only; "server" mode resolves with an empty
    // context and ignores per-request targetingKey (design §7.4).
    const mode = this.client.getEvaluationMode?.();
    if (mode === "server") {
      console.warn(
        '[Traffical] OpenFeature provider was constructed with an evaluationMode:"server" client. ' +
          'v1 supports "bundle" mode only — "server" mode resolves with an empty context and ignores ' +
          "per-request targetingKey, so every unit receives the same assignment."
      );
    }

    try {
      if (this.client.initialize) {
        await this.client.initialize();
      }
      this.initialized = true;
      this.events.emit(ProviderEvents.Ready);
    } catch (err) {
      // Irrecoverable config/credential errors → PROVIDER_FATAL (design §7.2).
      const message = err instanceof Error ? err.message : String(err);
      this.events.emit(ProviderEvents.Error, {
        message: `[Traffical] provider failed to initialize: ${message}`,
        errorCode: ErrorCode.PROVIDER_FATAL,
      });
      // Re-throw so the SDK sees the failure and stays NOT_READY/FATAL.
      throw err instanceof Error ? err : new ProviderFatalError(message);
    }
  }

  async onClose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.initialized = false;
    // Flush-then-dispose (design §7.2). Both are optional/feature-detected.
    await this.client.flushEvents?.();
    await this.client.destroy?.();
  }

  // ---------------------------------------------------------------------------
  // Resolvers (hot path)
  // ---------------------------------------------------------------------------

  async resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    context: EvaluationContext,
    _logger?: Logger
  ): Promise<ResolutionDetails<boolean>> {
    return this.resolve(flagKey, defaultValue, "boolean", context);
  }

  async resolveStringEvaluation(
    flagKey: string,
    defaultValue: string,
    context: EvaluationContext,
    _logger?: Logger
  ): Promise<ResolutionDetails<string>> {
    return this.resolve(flagKey, defaultValue, "string", context);
  }

  async resolveNumberEvaluation(
    flagKey: string,
    defaultValue: number,
    context: EvaluationContext,
    _logger?: Logger
  ): Promise<ResolutionDetails<number>> {
    return this.resolve(flagKey, defaultValue, "number", context);
  }

  async resolveObjectEvaluation<T extends JsonValue>(
    flagKey: string,
    defaultValue: T,
    context: EvaluationContext,
    _logger?: Logger
  ): Promise<ResolutionDetails<T>> {
    return this.resolve(flagKey, defaultValue, "object", context);
  }

  /**
   * The shared resolve path (design §4). Throws typed OpenFeature errors
   * (`TargetingKeyMissingError`, `TypeMismatchError`) up to the SDK boundary —
   * the SDK is the never-throw layer and maps them to the default + ERROR
   * reason with the correct errorCode (design §4.4, V1). We deliberately do NOT
   * catch-and-flatten to GENERAL.
   */
  private resolve<T extends JsonValue>(
    flagKey: string,
    defaultValue: T,
    expectedType: OFFlagType,
    context: EvaluationContext
  ): ResolutionDetails<T> {
    // (1) unit-key field the bundle buckets on.
    const unitKeyField = this.options.unitKey ?? this.client.getUnitKeyField();

    // (2) split context into targetingKey + remaining attributes, then build
    // the Traffical context. A thrown TargetingKeyMissingError propagates.
    const { targetingKey, ...attributes } = context;
    const trafficalContext = buildTrafficalContext({
      targetingKey,
      attributes,
      unitKeyField,
    });

    // (3) the flag's owning layer (never positional; design §3.3).
    const ownerLayerId = this.client.getParameterLayerId(flagKey);

    // (4) decide — emits the ITT decision event and caches the decision.
    // `defaults` is typed `Record<string, ParameterValue>` (no null/array), but
    // an object-flag default is a `JsonValue` (may be null/array). The default
    // only backfills an absent assignment; `toResolutionDetails` re-applies our
    // own `defaultValue` regardless, so a structural cast here is safe.
    const decision = this.client.decide({
      context: trafficalContext,
      defaults: { [flagKey]: defaultValue } as Record<string, ParameterValue>,
    });

    // (5) store the decision so exposure/reward can find it without re-deciding.
    this.storeDecision(flagKey, decision);
    this.decisionsEmitted += 1;

    // (6) optional exposure-on-resolve escape hatch (design §5).
    if (this.options.exposureOnResolve) {
      this.client.trackExposure(decision);
      this.exposuresEmitted += 1;
    }

    // (7) translate → ResolutionDetails; a TypeMismatchError propagates.
    const details = toResolutionDetails<T>({
      flagKey,
      defaultValue,
      expectedType,
      decision,
      ownerLayerId,
      gatePropensity: this.options.gatePropensity,
    });

    // (8) alarm check after each resolve.
    this.checkAlarm();

    return details;
  }

  // ---------------------------------------------------------------------------
  // Tracking (exposure + reward)
  // ---------------------------------------------------------------------------

  track(
    trackingEventName: string,
    context?: EvaluationContext,
    details?: TrackingEventDetails
  ): void {
    const exposureName = this.options.exposureEventName ?? EXPOSURE_EVENT_NAME;

    if (trackingEventName === exposureName) {
      this.trackExposureRoute(context, details);
      return;
    }

    this.trackRewardRoute(trackingEventName, context, details);
  }

  /**
   * Exposure route (design §5): find the decision the caller saw and record an
   * explicit exposure — NEVER re-decide. A miss warns once and no-ops.
   */
  private trackExposureRoute(
    context: EvaluationContext | undefined,
    details: TrackingEventDetails | undefined
  ): void {
    const unitKeyValue =
      typeof context?.targetingKey === "string" ? context.targetingKey : undefined;
    const flagKey = typeof details?.flagKey === "string" ? details.flagKey : undefined;

    const decisions = this.findDecisions(flagKey, unitKeyValue);

    if (decisions.length === 0) {
      this.warnExposureMiss();
      return;
    }

    for (const decision of decisions) {
      this.client.trackExposure(decision);
      this.exposuresEmitted += 1;
    }
  }

  /**
   * Reward route (design §6): every reward MUST carry a non-empty unit key or
   * it is silently unjoinable in the warehouse (the temporal first-touch reward
   * join is keyed on unit_key). Node's `track()` keeps `unitKey: ""` verbatim
   * (no stableId backfill), so a missing key would ship an unjoinable event and
   * silently drop the conversion from primary reward metrics. Fail loud: warn
   * once and DROP the event rather than emit an unjoinable reward — mirroring
   * the exposure route's drop-and-warn on a miss (design D4/Blocker-2).
   */
  private trackRewardRoute(
    name: string,
    context: EvaluationContext | undefined,
    details: TrackingEventDetails | undefined
  ): void {
    const unitKey =
      typeof context?.targetingKey === "string" ? context.targetingKey : undefined;

    if (!unitKey) {
      console.warn(
        `[Traffical] reward event "${name}" is missing a unit key (context.targetingKey) ` +
          "and was DROPPED. Reward metrics join on the unit key — an empty unit key is " +
          "unjoinable in the warehouse. Pass the evaluation context (with targetingKey) to track()."
      );
      return;
    }

    // Separate the numeric `value` from the rest of the details.
    const value = typeof details?.value === "number" ? details.value : undefined;
    const rest: Record<string, unknown> = {};
    if (details) {
      for (const [k, v] of Object.entries(details)) {
        if (k === "value") continue;
        rest[k] = v;
      }
    }

    this.client.track(name, { value, ...rest }, { unitKey });
  }

  // ---------------------------------------------------------------------------
  // Decision store helpers
  // ---------------------------------------------------------------------------

  /** Writes a decision into the active request store, else the fallback LRU. */
  private storeDecision(flagKey: string, decision: DecisionResult): void {
    const store = this.als.getStore();
    if (store) {
      store.set(flagKey, decision);
      return;
    }
    this.warnNoStore();
    this.putFallback(flagKey, decision);
  }

  /**
   * Finds the decision(s) for an exposure/reward, reading ONLY from the store
   * (never re-deciding). With a `flagKey`, returns that one decision; without
   * one, returns every decision recorded for the active request.
   */
  private findDecisions(
    flagKey: string | undefined,
    unitKeyValue: string | undefined
  ): DecisionResult[] {
    const store = this.als.getStore();

    // When the caller declared a unit (targetingKey), enforce it against the
    // store reads so an exposure for unit A can never stitch to unit B's
    // decision(s) — upholding "no cross-unit bleed" even if more than one
    // identity was resolved inside a single runInRequest scope, not merely "by
    // construction" (design §8). A mismatch falls through to drop+warn.
    const matchesUnit = (decision: DecisionResult): boolean =>
      unitKeyValue === undefined || decision.metadata.unitKeyValue === unitKeyValue;

    if (flagKey !== undefined) {
      const stored = store?.get(flagKey);
      const found =
        stored && matchesUnit(stored)
          ? stored
          : this.getFallback(unitKeyValue, flagKey);
      return found ? [found] : [];
    }

    // No flagKey: expose all decisions for this request (store only — the
    // fallback isn't request-scoped so "all" isn't meaningful there), still
    // filtered to the declared unit.
    if (store && store.size > 0) {
      return Array.from(store.values()).filter(matchesUnit);
    }
    return [];
  }

  private fallbackKey(unitKeyValue: string | undefined, flagKey: string): string {
    return `${unitKeyValue ?? ""}:${flagKey}`;
  }

  private putFallback(flagKey: string, decision: DecisionResult): void {
    const unitKeyValue = decision.metadata.unitKeyValue;
    const key = this.fallbackKey(unitKeyValue, flagKey);
    if (this.fallback.size >= FALLBACK_MAX) {
      const oldest = this.fallback.keys().next().value;
      if (oldest !== undefined) this.fallback.delete(oldest);
    }
    this.fallback.set(key, { decision, expiry: Date.now() + FALLBACK_TTL_MS });
  }

  private getFallback(
    unitKeyValue: string | undefined,
    flagKey: string
  ): DecisionResult | undefined {
    const key = this.fallbackKey(unitKeyValue, flagKey);
    const entry = this.fallback.get(key);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiry) {
      this.fallback.delete(key);
      return undefined;
    }
    return entry.decision;
  }

  // ---------------------------------------------------------------------------
  // Alarm + one-time warnings
  // ---------------------------------------------------------------------------

  /**
   * Decisions-without-exposures alarm (design §5, D2). Recording decisions but
   * never exposures means the platform's default primary metric (ToT), the SRM
   * health gate, and bandit training are all silently empty.
   */
  private checkAlarm(): void {
    if (
      !this.alarmed &&
      this.decisionsEmitted >= ALARM_DECISION_THRESHOLD &&
      this.exposuresEmitted === 0
    ) {
      this.alarmed = true;
      const message =
        `[Traffical] the provider has recorded ${this.decisionsEmitted} decisions but 0 exposures. ` +
        "Treatment-on-the-treated metrics, SRM health checks, and bandit optimization will all be EMPTY. " +
        `Fire client.track("${this.options.exposureEventName ?? EXPOSURE_EVENT_NAME}", context, { flagKey }) ` +
        "at your render sites, or set exposureOnResolve: true when constructing the provider.";
      console.warn(message);
      // Non-fatal signal (design §5 — do NOT use PROVIDER_FATAL).
      this.events.emit(ProviderEvents.Error, { message });
    }
  }

  private warnNoStore(): void {
    if (this.warnedNoStore) return;
    this.warnedNoStore = true;
    console.warn(
      "[Traffical] resolve ran without an active request store. Wrap each request in " +
        "provider.runInRequest(fn) so resolve, exposure and reward share one decision store. " +
        "Falling back to a bounded per-key cache (exposure/reward may miss under concurrency)."
    );
  }

  private warnExposureMiss(): void {
    if (this.warnedExposureMiss) return;
    this.warnedExposureMiss = true;
    console.warn(
      "[Traffical] an exposure was tracked but no matching decision was found — dropping it. " +
        "The provider never re-decides in the exposure path. Ensure the flag was resolved earlier " +
        "in the same request (wrap the request in provider.runInRequest(fn)) and echo the flagKey " +
        "in the tracking event details."
    );
  }
}

// -----------------------------------------------------------------------------
// Convenience factory
// -----------------------------------------------------------------------------

/**
 * Convenience factory. The primary API is constructor injection of an existing
 * client — this just forwards to the constructor for symmetry with other
 * OpenFeature providers.
 */
export function createTrafficalServerProvider(
  client: TrafficalServerClient,
  options?: TrafficalProviderOptions
): TrafficalServerProvider {
  return new TrafficalServerProvider(client, options);
}

export default TrafficalServerProvider;
