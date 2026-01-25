/**
 * Plugin types for Traffical JS Client SDK.
 *
 * Plugins can hook into various SDK lifecycle events.
 */

import type {
  ConfigBundle,
  DecisionResult,
  ExposureEvent,
  TrackEvent,
  Context,
  ParameterValue,
} from "@traffical/core";

/**
 * Plugin interface - implement any subset of hooks.
 */
export interface TrafficalPlugin {
  /** Unique plugin name */
  name: string;

  /**
   * Called after client initialization completes.
   */
  onInitialize?: () => void | Promise<void>;

  /**
   * Called when the config bundle is fetched or refreshed.
   * Useful for plugins that need access to bundle data (e.g., DOM bindings).
   */
  onConfigUpdate?: (bundle: ConfigBundle) => void;

  /**
   * Called before a decision is made.
   * Can modify context before resolution.
   */
  onBeforeDecision?: (context: Context) => Context | void;

  /**
   * Called after a decision is made.
   * Useful for logging, analytics, etc.
   */
  onDecision?: (decision: DecisionResult) => void;

  /**
   * Called after parameters are resolved via getParams().
   * Useful for plugins that need to react to parameter values (e.g., DOM bindings).
   */
  onResolve?: (params: Record<string, ParameterValue>) => void;

  /**
   * Called before an exposure is tracked.
   * Return false to prevent tracking.
   */
  onExposure?: (event: ExposureEvent) => boolean | void;

  /**
   * Called before an event is tracked.
   * Return false to prevent tracking.
   */
  onTrack?: (event: TrackEvent) => boolean | void;

  /**
   * Called when client is destroyed.
   * Cleanup resources here.
   */
  onDestroy?: () => void;
}

/**
 * Plugin registration options.
 */
export interface PluginOptions {
  /** Plugin instance */
  plugin: TrafficalPlugin;
  /** Priority (higher = runs first, default: 0) */
  priority?: number;
}

