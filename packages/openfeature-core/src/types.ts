import type { Context, DecisionResult, ParameterValue } from "@traffical/core";

/**
 * OpenFeature's four flag value shapes. Traffical's `ParameterType`
 * (`string | number | boolean | json`) maps 1:1 onto these — `json` → `object`.
 */
export type OFFlagType = "boolean" | "string" | "number" | "object";

/**
 * Construction options shared by both the server and web Traffical providers.
 */
export interface TrafficalProviderOptions {
  /**
   * Override the context field the bundle buckets on. Defaults to
   * `client.getUnitKeyField()` (the bundle's `hashing.unitKey`). Set this only
   * when you must force a specific field.
   */
  unitKey?: string;
  /**
   * Override the reserved exposure event name. Defaults to
   * `EXPOSURE_EVENT_NAME` (`$traffical.exposure`). Change it only to avoid a
   * collision with a real business event of the same name.
   */
  exposureEventName?: string;
  /**
   * When true, the resolver fires `trackExposure()` on the just-made decision
   * (collapsing ToT toward ITT). Escape hatch for teams that never fire the
   * explicit exposure signal.
   */
  exposureOnResolve?: boolean;
  /**
   * When true, omit `traffical.propensity` from `flagMetadata`. Web providers
   * set this so bandit selection internals aren't leaked to browser devtools.
   */
  gatePropensity?: boolean;
}

/**
 * The structural subset of a Traffical client that the OpenFeature providers
 * depend on. Both `@traffical/node` and `@traffical/js-client` clients satisfy
 * this shape, so a provider can be typed against it without importing either
 * concrete client (constructor injection — one client instance, caller owns
 * lifecycle).
 */
export interface TrafficalClientLike {
  /**
   * The context field name the loaded bundle buckets on
   * (`bundle.hashing.unitKey`), or null when no bundle is loaded.
   */
  getUnitKeyField(): string | null;
  /**
   * The id of the layer a parameter belongs to, or null when unknown. Used to
   * select the flag's owning layer from a single-key decide's per-layer
   * metadata.
   */
  getParameterLayerId(key: string): string | null;
  /**
   * The config bundle version currently loaded, or null when unknown.
   */
  getConfigVersion(): string | null;
  /**
   * Compute a decision for the given context + defaults. Emits the decision
   * (ITT) event and caches the decision by id.
   */
  decide<T extends Record<string, ParameterValue>>(opts: {
    context: Context;
    defaults: T;
  }): DecisionResult;
  /**
   * Record an explicit exposure (ToT) for a previously-made decision.
   */
  trackExposure(decision: DecisionResult): void;
  /**
   * Record a business event (conversion / reward).
   */
  track(
    event: string,
    properties?: Record<string, unknown>,
    options?: { decisionId?: string; unitKey?: string }
  ): void;
}
