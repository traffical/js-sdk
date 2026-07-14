/**
 * TrafficalWebProvider — the OpenFeature WEB (static-context) provider backed by
 * the Traffical browser SDK (`@traffical/js-client`).
 *
 * Design: see the OpenFeature provider design in the Traffical SDK spec, §2, §3, §5, §6, §7, §9, §13
 * (this is milestone M3). It is a thin, SYNC translation membrane over an
 * already-constructed native client (constructor injection — one client
 * instance, the caller owns lifecycle).
 *
 * Web specifics (vs the server provider):
 * - Resolvers are SYNCHRONOUS and receive NO per-invocation context; the
 *   provider evaluates against a single BOUND static context (§9).
 * - `onContextChange` re-binds the context and clears the per-context decision
 *   memo, then RETURNS — the web SDK (not the provider) emits the reconcile
 *   lifecycle events (§9, finding V2).
 * - `track(name, details)` takes NO context argument (web `Tracking`).
 * - `flagMetadata` gates BOTH `traffical.propensity` AND `traffical.modelVersion`
 *   out — browser devtools must not leak bandit selection internals (§3.5).
 */

import {
  OpenFeatureEventEmitter,
  ProviderEvents,
  ProviderFatalError,
  StandardResolutionReasons,
  type EvaluationContext,
  type JsonValue,
  type Logger,
  type Paradigm,
  type Provider,
  type ProviderMetadata,
  type ResolutionDetails,
  type Tracking,
  type TrackingEventDetails,
} from "@openfeature/web-sdk";

import {
  EXPOSURE_EVENT_NAME,
  FLAG_METADATA_PREFIX,
  buildTrafficalContext,
  toResolutionDetails,
  type OFFlagType,
  type TrafficalClientLike,
  type TrafficalProviderOptions,
} from "@traffical/openfeature-core";

import type { DecisionResult, ParameterValue } from "@traffical/core";

/**
 * The optional lifecycle surface a browser client may expose on top of the
 * frozen `TrafficalClientLike` contract. All optional so the provider can be
 * driven by a bare structural stub in tests, and so it never depends on hooks
 * that may not exist on every client.
 */
export interface TrafficalWebClient extends TrafficalClientLike {
  /** Async config fetch + background refresh start. */
  initialize?(): Promise<void>;
  /** Sync, unload-aware teardown (chooses `sendBeacon` on unload). */
  destroy?(): void;
  /** The anonymous stable id used when no explicit identity is set. */
  getStableId?(): string;
  /** Change identity + notify listeners (framework providers, plugins). */
  identify?(unitKey: string): void;
  /**
   * Register a plugin. Used (if present) to hang a config-change listener off
   * the client's EXISTING `runConfigUpdate` hook so a changed refresh can emit
   * `PROVIDER_CONFIGURATION_CHANGED`. Never required.
   */
  use?(plugin: {
    name: string;
    onConfigUpdate?: (bundle: unknown) => void;
  }): unknown;
}

const PROVIDER_NAME = "traffical-provider";

/**
 * How many decisions may accumulate with zero exposures before the
 * "decisions-without-exposures" alarm fires (once). Mirrors the server
 * provider's footgun defense (§5/D2).
 */
const NO_EXPOSURE_ALARM_THRESHOLD = 10;

/**
 * A decision is INERT when the web client's `decide()` error boundary returned
 * its fallback (`unitKeyValue: ""`, `layers: []`, `js-client:560`). An inert
 * decision must be treated as DEFAULT and never fed to exposure/attribution —
 * downstream it silently no-ops (§4.4).
 */
function isInertDecision(decision: DecisionResult): boolean {
  return decision.metadata.unitKeyValue === "" || decision.metadata.layers.length === 0;
}

export class TrafficalWebProvider implements Provider, Tracking {
  public readonly metadata: ProviderMetadata = { name: PROVIDER_NAME };

  /** The web SDK enforces this paradigm at runtime (prevents server/web mixups). */
  public readonly runsOn: Paradigm = "client";

  /** The provider owns its emitter; the SDK does not synthesize lifecycle events. */
  public readonly events = new OpenFeatureEventEmitter();

  private readonly client: TrafficalWebClient;
  private readonly options: TrafficalProviderOptions;

  /** The single bound static context. Starts empty; set in `initialize`. */
  private boundContext: EvaluationContext = {};

  /**
   * Per-context decision memo (flagKey → DecisionResult). Pure optimization and
   * the source the exposure route stitches against; CLEARED on every context
   * change so a stale-identity decision can never be exposed (§9). Inert
   * decisions are never stored.
   */
  private decisionMemo = new Map<string, DecisionResult>();

  /** No-exposure alarm counters + one-shot guards (§5). */
  private decisionCount = 0;
  private exposureCount = 0;
  private noExposureAlarmFired = false;
  private exposureMissWarned = false;

  private closed = false;

  constructor(client: TrafficalWebClient, options?: TrafficalProviderOptions) {
    this.client = client;
    // Web always gates propensity/modelVersion out of flagMetadata (browser
    // devtools are user-visible). We additionally strip modelVersion below,
    // because core gates propensity but NOT modelVersion.
    this.options = { gatePropensity: true, ...options };
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async initialize(context?: EvaluationContext): Promise<void> {
    this.closed = false;
    this.boundContext = context ?? {};
    try {
      await this.client.initialize?.();
      this.wireConfigChangeSignal();
      this.events.emit(ProviderEvents.Ready);
    } catch (err) {
      // Any failure to initialize is treated as irrecoverable: the client
      // could not load a bundle, so every resolve would degrade to DEFAULT.
      this.events.emit(ProviderEvents.Error, {
        message: err instanceof Error ? err.message : String(err),
        errorCode: new ProviderFatalError().code,
      });
      // Rethrow so the SDK also transitions the provider to a FATAL state.
      throw err;
    }
  }

  async onClose(): Promise<void> {
    if (this.closed) return; // idempotent (guard double-close)
    this.closed = true;
    // The browser client's destroy() is sync and unload-aware (it chooses
    // sendBeacon on unload). Do NOT await an async flush on web (§7.2).
    this.client.destroy?.();
    this.decisionMemo.clear();
  }

  // ===========================================================================
  // Static-context reconcile (§9, finding V2)
  // ===========================================================================

  /**
   * Re-bind the context and clear the per-context decision memo, then RETURN.
   *
   * Returning `void` makes the web SDK emit only `PROVIDER_CONTEXT_CHANGED`
   * (returning a Promise would make it emit `PROVIDER_RECONCILING` first). The
   * provider MUST NOT emit `Reconciling`/`ContextChanged`/`Stale` itself — that
   * would double-emit / race the SDK.
   */
  onContextChange(_oldContext: EvaluationContext, newContext: EvaluationContext): void {
    this.boundContext = newContext ?? {};
    // Clear the memo so a decision made under the old identity can never be
    // served (or exposed) under the new one.
    this.decisionMemo.clear();

    // Flow identity through the client so its stable-id / exposure-dedup state
    // tracks the new identity (rapid login/logout). Best-effort: identify() is
    // optional on the structural client.
    const targetingKey = newContext?.targetingKey;
    if (typeof targetingKey === "string" && targetingKey !== "") {
      this.client.identify?.(targetingKey);
    }
    // Return void → SDK emits CONTEXT_CHANGED only.
  }

  // ===========================================================================
  // Resolvers (SYNC — evaluate against the BOUND context, ignore the arg)
  // ===========================================================================

  resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    _context?: EvaluationContext,
    _logger?: Logger,
  ): ResolutionDetails<boolean> {
    return this.resolve(flagKey, defaultValue, "boolean");
  }

  resolveStringEvaluation(
    flagKey: string,
    defaultValue: string,
    _context?: EvaluationContext,
    _logger?: Logger,
  ): ResolutionDetails<string> {
    return this.resolve(flagKey, defaultValue, "string");
  }

  resolveNumberEvaluation(
    flagKey: string,
    defaultValue: number,
    _context?: EvaluationContext,
    _logger?: Logger,
  ): ResolutionDetails<number> {
    return this.resolve(flagKey, defaultValue, "number");
  }

  resolveObjectEvaluation<T extends JsonValue>(
    flagKey: string,
    defaultValue: T,
    _context?: EvaluationContext,
    _logger?: Logger,
  ): ResolutionDetails<T> {
    return this.resolve(flagKey, defaultValue, "object");
  }

  /**
   * The single translation path shared by all four resolvers.
   *
   * A thrown `TargetingKeyMissingError`/`TypeMismatchError` propagates: the web
   * SDK is the never-throw boundary and maps typed errors to the default +
   * `reason: ERROR` (§4.4). We do NOT blanket-catch to `GENERAL`.
   */
  private resolve<T extends JsonValue>(
    flagKey: string,
    defaultValue: T,
    expectedType: OFFlagType,
  ): ResolutionDetails<T> {
    // (1) Map the targeting key onto EXACTLY the bundle's unit-key field so the
    // web client's _enrichContext does not override it with the anonymous
    // stableId (which would silently mis-bucket).
    const unitKeyField = this.options.unitKey ?? this.client.getUnitKeyField();

    // (2) Build the Traffical context; a missing targeting key throws
    // TargetingKeyMissingError, which we let propagate to the SDK boundary.
    const { targetingKey, ...attributes } = this.boundContext;
    const ctx = buildTrafficalContext({
      targetingKey: typeof targetingKey === "string" ? targetingKey : undefined,
      attributes,
      unitKeyField,
    });

    // (3) Owning-layer id — robust selection (never positional layers[0]).
    const ownerLayerId = this.client.getParameterLayerId(flagKey);

    // OpenFeature `JsonValue` admits `null`; Traffical's `ParameterValue` does
    // not. The default is only a fallback the engine echoes back untouched, so
    // the boundary cast is sound (the strict type check happens in
    // toResolutionDetails, which accepts any JSON value for object flags).
    const decision = this.client.decide({
      context: ctx,
      defaults: { [flagKey]: defaultValue as ParameterValue },
    });

    // Inert decision (error-boundary fallback) → DEFAULT. Never stored, never
    // exposed, never fed to attribution downstream.
    if (isInertDecision(decision)) {
      return { value: defaultValue, reason: StandardResolutionReasons.DEFAULT };
    }

    this.decisionCount++;

    // (4) Memoize the real decision so the exposure route can stitch to it
    // without ever re-deciding (D3/A2).
    this.decisionMemo.set(flagKey, decision);

    // Opt-in escape hatch: fire the exposure on the just-made decision
    // (collapsing ToT toward ITT). Uses the SAME decision — never re-decides —
    // and relies on the client's exposure dedup + attributionOnly skip (§5).
    if (this.options.exposureOnResolve) {
      this.exposureCount++;
      this.client.trackExposure(decision);
    }

    this.maybeFireNoExposureAlarm();

    // (5) Translate. `toResolutionDetails` throws TypeMismatchError on a strict
    // type mismatch (no coercion) — let it propagate.
    const details = toResolutionDetails<T>({
      flagKey,
      defaultValue,
      expectedType,
      decision,
      ownerLayerId,
      gatePropensity: this.options.gatePropensity,
    });

    // Web hardening: core gates propensity but NOT modelVersion. On web,
    // flagMetadata is visible in browser devtools, so strip the model version
    // too (§3.5) — never leak the model version to the client.
    if (details.flagMetadata) {
      delete (details.flagMetadata as Record<string, unknown>)[`${FLAG_METADATA_PREFIX}.modelVersion`];
    }

    return details;
  }

  // ===========================================================================
  // Tracking (web `Tracking` — NO context arg)
  // ===========================================================================

  track(trackingEventName: string, details?: TrackingEventDetails): void {
    const exposureEventName = this.options.exposureEventName ?? EXPOSURE_EVENT_NAME;

    if (trackingEventName === exposureEventName) {
      this.routeExposure(details);
      return;
    }

    this.routeReward(trackingEventName, details);
  }

  /**
   * Exposure route: stitch to the memoized decision and call `trackExposure`.
   * NEVER re-decide. A miss (no memoized decision for `flagKey`) warns once and
   * no-ops (§5).
   */
  private routeExposure(details?: TrackingEventDetails): void {
    const flagKey = details && typeof details.flagKey === "string" ? details.flagKey : undefined;
    const decision = flagKey ? this.decisionMemo.get(flagKey) : undefined;

    if (!decision) {
      if (!this.exposureMissWarned) {
        this.exposureMissWarned = true;
        console.warn(
          `[Traffical][OpenFeature] Exposure fired for flag "${flagKey ?? "<missing flagKey>"}" ` +
            "but no matching decision was found in the current context. " +
            "Resolve the flag before firing its exposure; never re-decide in the exposure path.",
        );
      }
      return;
    }

    this.exposureCount++;
    this.client.trackExposure(decision);
  }

  /**
   * Reward route: identity comes from the bound targeting key (falling back to
   * the client's anonymous stableId). `value` is lifted out of `details`; the
   * rest ride as properties.
   */
  private routeReward(eventName: string, details?: TrackingEventDetails): void {
    const boundKey = this.boundContext.targetingKey;
    const unitKey =
      typeof boundKey === "string" && boundKey !== "" ? boundKey : this.client.getStableId?.();

    const value = details && typeof details.value === "number" ? details.value : undefined;
    const rest: Record<string, unknown> = {};
    if (details) {
      for (const [k, v] of Object.entries(details)) {
        if (k === "value") continue;
        rest[k] = v;
      }
    }

    this.client.track(eventName, { value, ...rest }, { unitKey });
  }

  // ===========================================================================
  // No-exposure alarm (§5/D2)
  // ===========================================================================

  private maybeFireNoExposureAlarm(): void {
    if (this.noExposureAlarmFired) return;
    if (this.decisionCount > NO_EXPOSURE_ALARM_THRESHOLD && this.exposureCount === 0) {
      this.noExposureAlarmFired = true;
      const message =
        "recording decisions but no exposures; ToT/SRM/optimization will be empty. " +
        `Fire "${this.options.exposureEventName ?? EXPOSURE_EVENT_NAME}", or set exposureOnResolve.`;
      console.warn(`[Traffical][OpenFeature] ${message}`);
      // Non-fatal — the provider is still usable, this is a footgun alarm.
      this.events.emit(ProviderEvents.Error, { message });
    }
  }

  // ===========================================================================
  // PROVIDER_CONFIGURATION_CHANGED (§7.3) — optional, via the EXISTING
  // js-client runConfigUpdate plugin hook. No new js-client hooks are added.
  // ===========================================================================

  private wireConfigChangeSignal(): void {
    if (typeof this.client.use !== "function") {
      // TODO: no plugin surface on this client — config-change signalling is
      // skipped. The bundle still refreshes silently in the background.
      return;
    }
    let lastVersion = this.client.getConfigVersion();
    this.client.use({
      name: "openfeature-config-change",
      onConfigUpdate: () => {
        const next = this.client.getConfigVersion();
        if (next !== null && next !== lastVersion) {
          lastVersion = next;
          // The memo is a pure optimization, safe-to-miss, and MUST be
          // configVersion-invalidated (design §9, A1/A5): a background refresh
          // can change the served value / decisionId / propensity / configVersion,
          // so any memoized decision is now stale. Clearing it turns a
          // post-refresh exposure into a safe drop+warn (memo miss) rather than
          // stitching to a decision that no longer matches what the user is served.
          this.decisionMemo.clear();
          this.events.emit(ProviderEvents.ConfigurationChanged);
        }
      },
    });
  }
}

export default TrafficalWebProvider;
