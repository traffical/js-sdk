/**
 * Tiered error policy shared by every JS SDK client.
 *
 * The SDK sits in the request path of a product it does not own, so the
 * question is never "should errors surface" but "which failures may change
 * which answers". Three tiers, and the rule that binds them:
 *
 *   **A lower tier must never change a higher tier's answer.**
 *
 * | Tier | Covers                                            | Posture                            | Configurable |
 * |------|---------------------------------------------------|------------------------------------|--------------|
 * | 1    | assignmentLogger, eventLogger, plugin hooks, transport | always caught + counted        | no           |
 * | 2    | decide / getParams / trackExposure / track        | caller defaults + structured reason | yes         |
 * | 3    | bundle ingestion (fetch and localConfig)          | reject whole, keep last-good       | no           |
 *
 * Tier 1 is deliberately not configurable. Every comparable SDK — OpenFeature,
 * Statsig, Eppo, GrowthBook — guards the customer's logging callback narrowly
 * and unconditionally, and Eppo does so even when the integrator has explicitly
 * asked for strict mode. A delivery sink that throws must cost you a log row,
 * never a variant: letting it fall back to defaults puts a load-correlated
 * confound straight into the treatment assignment, because bounded queues throw
 * precisely when traffic spikes.
 */

/**
 * What a Tier-2 resolution failure does.
 *
 * - `"default"` — return the caller's defaults with `metadata.reason: "error"`.
 *   The default, and the right choice in production.
 * - `"throw"` — rethrow. Useful in CI and staging to make a broken bundle or a
 *   broken integration loud. Never affects Tier 1.
 */
export type OnResolutionError = "default" | "throw";

/** Why a decision carries the values it does. Mirrors OpenFeature's `reason`. */
export type ResolutionReason =
  /** A policy matched and supplied overrides. */
  | "resolved"
  /** Resolution succeeded; no policy matched, so parameter/caller defaults apply. */
  | "default"
  /** No usable bundle (cold start, or every candidate was rejected). */
  | "no-bundle"
  /** Resolution threw and was contained. Values are the caller's defaults. */
  | "error";

/** Counters for degradation that is otherwise invisible. Monotonic per client. */
export interface SdkDiagnostics {
  /** Tier-2 resolution failures contained by the policy. */
  resolutionErrors: number;
  /** `assignmentLogger` invocations that threw. */
  droppedAssignmentLogs: number;
  /** `eventLogger` invocations that threw. */
  droppedEventLogs: number;
  /** Bundles rejected by deep validation, at any ingestion point. */
  rejectedBundles: number;
  /** Other contained side-effect failures (plugins, transport, storage). */
  sideEffectErrors: number;
  /** The most recent contained error, for debugging. Not cleared by reads. */
  lastError: { tag: string; name: string; message: string } | null;
}

/** Which counter a Tier-1 failure increments. */
export type SideEffectKind =
  | "assignmentLog"
  | "eventLog"
  | "bundleRejected"
  | "other";

export interface ErrorPolicyOptions {
  /**
   * What a Tier-2 resolution failure does. Default `"default"`.
   * Tier-1 side effects ignore this entirely.
   */
  onResolutionError?: OnResolutionError;
  /**
   * Called for every contained error, Tier 1 and Tier 2 alike, before any
   * fallback is returned. Errors thrown by this callback are swallowed — it is
   * itself a Tier-1 side effect.
   *
   * Deduplicated per `tag:name:message` so a hot path cannot flood it.
   */
  onError?: (tag: string, error: Error) => void;
}

const NOOP_DIAGNOSTICS: SdkDiagnostics = {
  resolutionErrors: 0,
  droppedAssignmentLogs: 0,
  droppedEventLogs: 0,
  rejectedBundles: 0,
  sideEffectErrors: 0,
  lastError: null,
};

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  return new Error("An unknown error occurred");
}

export class ErrorPolicy {
  private readonly _onResolutionError: OnResolutionError;
  private readonly _onError?: (tag: string, error: Error) => void;
  private readonly _seen = new Set<string>();
  private readonly _counters: SdkDiagnostics = { ...NOOP_DIAGNOSTICS };

  constructor(options: ErrorPolicyOptions = {}) {
    this._onResolutionError = options.onResolutionError ?? "default";
    this._onError = options.onError;
  }

  /** True when the caller opted into loud failures. */
  get throwsOnResolutionError(): boolean {
    return this._onResolutionError === "throw";
  }

  /**
   * Tier 2 — run a resolution and contain failures.
   *
   * On `onResolutionError: "throw"` the error is reported and rethrown, so the
   * integrator sees the real stack. Otherwise `fallback()` supplies the answer.
   * `fallback` is a thunk so the (allocating) default result is only built on
   * the failure path.
   */
  resolve<T>(tag: string, fn: () => T, fallback: () => T): T {
    try {
      return fn();
    } catch (error) {
      this._counters.resolutionErrors++;
      this._report(tag, error);
      if (this._onResolutionError === "throw") throw error;
      return fallback();
    }
  }

  /** Tier 2 for promise-returning resolution (initialization, async resolve). */
  async resolveAsync<T>(tag: string, fn: () => Promise<T>, fallback: () => T): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      this._counters.resolutionErrors++;
      this._report(tag, error);
      if (this._onResolutionError === "throw") throw error;
      return fallback();
    }
  }

  /**
   * Tier 1 — run a side effect that must never change a caller's answer.
   *
   * Never rethrows, regardless of `onResolutionError`. This is the guard that
   * belongs around every customer-supplied callback.
   */
  sideEffect(tag: string, kind: SideEffectKind, fn: () => void): void {
    try {
      fn();
    } catch (error) {
      this._countSideEffect(kind);
      this._report(tag, error);
    }
  }

  /** Tier 1 for promise-returning work (event flush, storage writes). */
  async sideEffectAsync(tag: string, kind: SideEffectKind, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this._countSideEffect(kind);
      this._report(tag, error);
    }
  }

  /** Tier 3 — record that a bundle was rejected, with the validation path. */
  recordRejectedBundle(tag: string, path: string, reason: string): void {
    this._counters.rejectedBundles++;
    this._report(tag, new Error(path ? `${path}: ${reason}` : reason));
  }

  /** A snapshot of the counters. Safe to poll; never resets. */
  getDiagnostics(): SdkDiagnostics {
    return { ...this._counters };
  }

  /** Test/reset hook — clears counters and the dedup set. */
  reset(): void {
    Object.assign(this._counters, NOOP_DIAGNOSTICS, { lastError: null });
    this._seen.clear();
  }

  private _countSideEffect(kind: SideEffectKind): void {
    switch (kind) {
      case "assignmentLog":
        this._counters.droppedAssignmentLogs++;
        break;
      case "eventLog":
        this._counters.droppedEventLogs++;
        break;
      case "bundleRejected":
        this._counters.rejectedBundles++;
        break;
      default:
        this._counters.sideEffectErrors++;
    }
  }

  private _report(tag: string, error: unknown): void {
    const resolved = toError(error);
    this._counters.lastError = {
      tag,
      name: resolved.name,
      message: resolved.message,
    };

    // Dedup on the full triple, not just the error name: a second distinct
    // TypeError elsewhere in the SDK must still be reported.
    const key = `${tag}:${resolved.name}:${resolved.message}`;
    if (this._seen.has(key)) return;
    this._seen.add(key);

    console.warn(`[Traffical] Contained error in ${tag}:`, resolved.message);

    if (!this._onError) return;
    try {
      this._onError(tag, resolved);
    } catch {
      // The error reporter is itself a Tier-1 side effect.
    }
  }
}
