/**
 * Traffical React Context
 *
 * Provides the Traffical client instance to React components.
 * Uses the browser-optimized JS Client for full feature support.
 */

import { createContext, useContext } from "react";
import type { TrafficalClient, TrafficalPlugin } from "@traffical/js-client";
import type { ConfigBundle, Context } from "@traffical/core";

/**
 * Configuration for the Traffical provider.
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

  /** Base URL for the control plane API (optional) */
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
  // Optional - SSR
  // ==========================================================================

  /** Initial params from SSR (optional) */
  initialParams?: Record<string, unknown>;
}

/**
 * Internal context value.
 */
export interface TrafficalContextValue {
  /** The Traffical client instance */
  client: TrafficalClient | null;
  /** Whether the client is ready (config loaded) */
  ready: boolean;
  /** Any initialization error */
  error: Error | null;
  /** Function to get the unit key */
  getUnitKey: () => string;
  /** Function to get the full context */
  getContext: () => Context;
  /** Initial params from SSR */
  initialParams?: Record<string, unknown>;
  /** Local config bundle for synchronous resolution during initial render */
  localConfig?: ConfigBundle;
}

/**
 * React context for Traffical.
 */
export const TrafficalContext = createContext<TrafficalContextValue | null>(
  null
);

/**
 * Hook to access the Traffical context.
 * Throws if used outside of TrafficalProvider.
 */
export function useTrafficalContext(): TrafficalContextValue {
  const context = useContext(TrafficalContext);
  if (!context) {
    throw new Error(
      "useTrafficalContext must be used within a TrafficalProvider"
    );
  }
  return context;
}
