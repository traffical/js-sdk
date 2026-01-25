/**
 * @traffical/svelte - Type Definitions
 *
 * TypeScript types for the Svelte 5 SDK.
 */

import type { TrafficalClient, TrafficalPlugin } from "@traffical/js-client";
import type {
  ConfigBundle,
  Context,
  DecisionResult,
  ParameterValue,
} from "@traffical/core";

// =============================================================================
// Provider Configuration
// =============================================================================

/**
 * Configuration for the TrafficalProvider component.
 */
export interface TrafficalProviderConfig {
  // ==========================================================================
  // Required
  // ==========================================================================

  /** Organization ID */
  orgId: string;
  /** Project ID */
  projectId: string;
  /** Environment (e.g., "production", "staging") */
  env: string;
  /** API key for authentication */
  apiKey: string;

  // ==========================================================================
  // Optional - Connection
  // ==========================================================================

  /** Base URL for the SDK API (edge worker) */
  baseUrl?: string;
  /** Local config bundle for offline fallback */
  localConfig?: ConfigBundle;
  /** Refresh interval in milliseconds (default: 60000) */
  refreshIntervalMs?: number;

  // ==========================================================================
  // Optional - Identity
  // ==========================================================================

  /**
   * Function to get the unit key value.
   * If not provided, the SDK will use automatic stable ID generation.
   */
  unitKeyFn?: () => string;
  /** Function to get additional context (optional) */
  contextFn?: () => Context;

  // ==========================================================================
  // Optional - Decision Tracking
  // ==========================================================================

  /**
   * Whether to automatically track decision events (default: true).
   * When enabled, every call to decide() automatically sends a DecisionEvent
   * to the control plane, enabling intent-to-treat analysis.
   */
  trackDecisions?: boolean;
  /**
   * Decision deduplication TTL in milliseconds (default: 1 hour).
   * Same user+assignment combination won't be tracked again within this window.
   */
  decisionDeduplicationTtlMs?: number;

  // ==========================================================================
  // Optional - Exposure Tracking
  // ==========================================================================

  /**
   * Exposure deduplication session TTL in milliseconds (default: 30 minutes).
   * Same user seeing same variant won't trigger multiple exposure events.
   */
  exposureSessionTtlMs?: number;

  // ==========================================================================
  // Optional - Plugins
  // ==========================================================================

  /**
   * Plugins to register with the client.
   * The DecisionTrackingPlugin is included by default unless trackDecisions is false.
   */
  plugins?: TrafficalPlugin[];

  // ==========================================================================
  // Optional - Event Batching
  // ==========================================================================

  /** Max events before auto-flush (default: 10) */
  eventBatchSize?: number;
  /** Auto-flush interval in ms (default: 30000) */
  eventFlushIntervalMs?: number;

  // ==========================================================================
  // Optional - SSR/Hydration
  // ==========================================================================

  /**
   * Pre-fetched config bundle from server-side load function.
   * When provided, the SDK is immediately ready without fetching.
   */
  initialBundle?: ConfigBundle | null;

  /**
   * Pre-resolved params from SSR for immediate hydration.
   * Used to prevent FOOC (Flash of Original Content).
   */
  initialParams?: Record<string, unknown>;
}

// =============================================================================
// Context Types
// =============================================================================

/**
 * Internal context value shared via Svelte's setContext/getContext.
 */
export interface TrafficalContextValue {
  /** The Traffical client instance (null during SSR) */
  readonly client: TrafficalClient | null;
  /** Whether the client is ready (config loaded) */
  readonly ready: boolean;
  /** Any initialization error */
  readonly error: Error | null;
  /** The current config bundle */
  readonly bundle: ConfigBundle | null;
  /** Function to get the unit key */
  getUnitKey: () => string;
  /** Function to get the full context */
  getContext: () => Context;
  /**
   * Initialize the client (fetches config).
   * Called automatically by TrafficalProvider after mount.
   * Only runs on client-side to avoid SSR fetch warnings.
   */
  initializeClient: () => Promise<void>;
  /** Initial params from SSR for hydration */
  initialParams?: Record<string, unknown>;
}

// =============================================================================
// Hook Types
// =============================================================================

/**
 * Options for the useTraffical hook.
 */
export interface UseTrafficalOptions<
  T extends Record<string, ParameterValue> = Record<string, ParameterValue>,
> {
  /** Default parameter values (required for type inference) */
  defaults: T;

  /** Additional context to merge (optional) */
  context?: Context;

  /**
   * Tracking mode (default: "full")
   * - "full": Track decision + exposure (default, recommended for UI)
   * - "decision": Track decision only, manual exposure control
   * - "none": No tracking (SSR, internal logic, tests)
   */
  tracking?: "full" | "decision" | "none";
}

/**
 * Options for the bound track function returned by useTraffical.
 */
export interface BoundTrackOptions {
  /** Additional event properties */
  properties?: Record<string, unknown>;
}

/**
 * @deprecated Use BoundTrackOptions instead.
 * Options for the bound trackReward function returned by useTraffical.
 */
export interface BoundTrackRewardOptions {
  /** The reward value (e.g., revenue amount, conversion count) */
  reward: number;
  /** Type of reward (e.g., "revenue", "conversion", "engagement") */
  rewardType?: string;
  /** Multiple reward values keyed by type */
  rewards?: Record<string, number>;
}

/**
 * Return value from the useTraffical hook.
 * All properties are reactive via Svelte 5 runes.
 */
export interface UseTrafficalResult<
  T extends Record<string, ParameterValue> = Record<string, ParameterValue>,
> {
  /** Resolved parameter values (reactive) */
  readonly params: T;
  /** The full decision result (null when tracking="none") */
  readonly decision: DecisionResult | null;
  /** Whether the client is ready (config loaded) */
  readonly ready: boolean;
  /** Any error that occurred */
  readonly error: Error | null;
  /** Function to manually track exposure (no-op when tracking="none") */
  trackExposure: () => void;
  /**
   * Track a user event. The decisionId is automatically bound.
   * No-op if tracking="none" or no decision is available.
   *
   * @example
   * track('purchase', { value: 99.99, orderId: 'ord_123' });
   * track('add_to_cart', { itemId: 'sku_456' });
   */
  track: (event: string, properties?: Record<string, unknown>) => void;
  /**
   * @deprecated Use track() instead.
   * Track a reward for this decision. The decisionId is automatically bound.
   * No-op if tracking="none" or no decision is available.
   */
  trackReward: (options: BoundTrackRewardOptions) => void;
}

/**
 * Options for tracking an event with the standalone hook.
 */
export interface TrackEventOptions {
  /** Event name (e.g., 'purchase', 'add_to_cart') */
  event: string;
  /** Additional event properties */
  properties?: Record<string, unknown>;
  /** Reference to the decision (optional, for attribution) */
  decisionId?: string;
}

/**
 * @deprecated Use TrackEventOptions instead.
 * Options for tracking a reward.
 */
export interface TrackRewardOptions {
  /** Reference to the decision (optional, will use last decision if not provided) */
  decisionId?: string;
  /** The reward value (e.g., revenue amount, conversion count) */
  reward: number;
  /** Type of reward (e.g., "revenue", "conversion", "engagement") */
  rewardType?: string;
  /** Multiple reward values keyed by type */
  rewards?: Record<string, number>;
}

// =============================================================================
// SvelteKit Types
// =============================================================================

/**
 * Options for loading the Traffical config bundle in a SvelteKit load function.
 */
export interface LoadTrafficalBundleOptions {
  /** Organization ID */
  orgId: string;
  /** Project ID */
  projectId: string;
  /** Environment (e.g., "production", "staging") */
  env: string;
  /** API key for authentication */
  apiKey: string;
  /** SvelteKit's fetch function (from load context) */
  fetch: typeof globalThis.fetch;
  /** Base URL for the SDK API (optional, defaults to https://sdk.traffical.io) */
  baseUrl?: string;
}

/**
 * Result from loading the Traffical config bundle.
 */
export interface LoadTrafficalBundleResult {
  /** The fetched config bundle, or null if fetch failed */
  bundle: ConfigBundle | null;
  /** Error message if fetch failed */
  error?: string;
}

// =============================================================================
// Re-exports for convenience
// =============================================================================

export type {
  ConfigBundle,
  Context,
  DecisionResult,
  ParameterValue,
  TrafficalClient,
  TrafficalPlugin,
};

// Server-side types (from @traffical/node)
export type { TrafficalClientOptions } from "@traffical/node";

