/**
 * Traffical React Hooks
 *
 * React hooks for parameter resolution and decision tracking.
 * Uses the browser-optimized JS Client for full feature support.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type {
  ParameterValue,
  DecisionResult,
  Context,
} from "@traffical/core";
import { resolveParameters } from "@traffical/core";
import type { TrafficalPlugin } from "@traffical/js-client";
import { useTrafficalContext } from "./context.js";

// =============================================================================
// Internal Utilities
// =============================================================================

/**
 * Creates a stable string key from an object for use in dependency arrays.
 * This prevents infinite re-renders when users pass inline objects to hooks.
 *
 * Uses JSON.stringify with sorted keys to ensure consistent ordering.
 */
function createStableKey(obj: unknown): string {
  if (obj === null || obj === undefined) {
    return String(obj);
  }
  if (typeof obj !== "object") {
    return String(obj);
  }
  // Sort keys for consistent ordering
  return JSON.stringify(obj, Object.keys(obj as object).sort());
}

/**
 * Custom hook that returns a stable reference to an object.
 * Only updates the reference when the object's serialized value changes.
 *
 * This allows users to pass inline objects without causing infinite re-renders:
 * ```tsx
 * // This now works without memoization!
 * const { params } = useTraffical({
 *   defaults: { 'ui.color': '#000' }, // inline object is fine
 * });
 * ```
 */
function useStableObject<T>(obj: T): T {
  const stableKey = createStableKey(obj);
  const ref = useRef(obj);

  // Only update the ref when the serialized value actually changes
  // This is safe because we're comparing by value, not reference
  if (createStableKey(ref.current) !== stableKey) {
    ref.current = obj;
  }

  return ref.current;
}

// =============================================================================
// useTraffical - Primary Hook
// =============================================================================

/**
 * Options for the useTraffical hook.
 */
export interface UseTrafficalOptions<T> {
  /** Default parameter values */
  defaults: T;

  /** Additional context (optional) */
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
 */
export interface UseTrafficalResult<T> {
  /** Resolved parameter values */
  params: T;
  /** The full decision result (null when tracking="none") */
  decision: DecisionResult | null;
  /** Whether the client is ready (config loaded) */
  ready: boolean;
  /** Any error that occurred */
  error: Error | null;
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
 * Primary hook for Traffical parameter resolution and decision tracking.
 *
 * On first render, returns defaults immediately (no blocking).
 * When the config bundle loads, recomputes and returns resolved values.
 *
 * @example
 * ```tsx
 * // Full tracking (default) - decision + exposure events
 * const { params, decision, ready } = useTraffical({
 *   defaults: { "checkout.ctaText": "Buy Now" },
 * });
 *
 * // Decision tracking only - manual exposure control
 * const { params, decision, trackExposure } = useTraffical({
 *   defaults: { "checkout.ctaText": "Buy Now" },
 *   tracking: "decision",
 * });
 *
 * // No tracking - for SSR, tests, or internal logic
 * const { params, ready } = useTraffical({
 *   defaults: { "ui.hero.title": "Welcome" },
 *   tracking: "none",
 * });
 * ```
 */
export function useTraffical<T extends Record<string, ParameterValue>>(
  options: UseTrafficalOptions<T>
): UseTrafficalResult<T> {
  const { client, ready, error, getContext, getUnitKey, initialParams, localConfig } =
    useTrafficalContext();

  const trackingMode = options.tracking ?? "full";
  const shouldTrackDecision = trackingMode !== "none";
  const shouldAutoTrackExposure = trackingMode === "full";

  // Create stable references for objects to prevent infinite re-renders
  // when users pass inline objects like: useTraffical({ defaults: { ... } })
  const stableDefaults = useStableObject(options.defaults);
  const stableContext = useStableObject(options.context);

  // Track if we resolved synchronously (to avoid duplicate resolution in useEffect)
  const resolvedSyncRef = useRef(false);
  const syncDecisionRef = useRef<DecisionResult | null>(null);

  // State - resolve synchronously if possible to prevent flicker
  const [params, setParams] = useState<T>(() => {
    // If client is already ready (e.g., subsequent page navigation), resolve synchronously
    // This prevents the default -> resolved flicker (classic A/B testing problem)
    if (client && ready) {
      resolvedSyncRef.current = true;

      const context: Context = {
        ...getContext(),
        ...(options.context ?? {}),
      };

      if (shouldTrackDecision) {
        // Use decide() for tracked decisions
        const result = client.decide({
          context,
          defaults: options.defaults,
        });
        syncDecisionRef.current = result;
        return result.assignments as T;
      } else {
        // Use getParams() for untracked
        return client.getParams({
          context,
          defaults: options.defaults,
        }) as T;
      }
    }

    // NEW: If we have localConfig bundle, resolve synchronously even before client is ready
    // This is the key to flicker-free SSR: server and client both resolve from the same bundle
    if (localConfig) {
      try {
        const context = getContext();
        // Only resolve if we have a userId (set by server via cookie/header)
        if (context.userId) {
          resolvedSyncRef.current = true;
          const fullContext: Context = {
            ...context,
            ...(options.context ?? {}),
          };
          // Use pure resolution function from core - no tracking on initial render
          const resolved = resolveParameters(localConfig, fullContext, options.defaults);
          return resolved as T;
        }
      } catch {
        // Context function not ready, fall through to defaults
      }
    }

    // Fallback to defaults (no localConfig or no userId)
    if (initialParams) {
      return { ...stableDefaults, ...initialParams } as T;
    }
    return stableDefaults;
  });

  const [decision, setDecision] = useState<DecisionResult | null>(
    () => syncDecisionRef.current
  );
  const [hasTrackedExposure, setHasTrackedExposure] = useState(false);

  // Manual exposure tracking (synchronous - batched internally)
  const trackExposure = useCallback(() => {
    // No-op when tracking is "none"
    if (trackingMode === "none") {
      return;
    }
    if (!client || !decision || hasTrackedExposure) {
      return;
    }
    client.trackExposure(decision);
    setHasTrackedExposure(true);
  }, [client, decision, hasTrackedExposure, trackingMode]);

  // Resolve params or make decision when client is ready
  useEffect(() => {
    if (!client || !ready) {
      return;
    }

    // Build context using stable references
    const context: Context = {
      ...getContext(),
      ...stableContext,
    };

    if (shouldTrackDecision) {
      // Use decide() - tracks decision event via DecisionTrackingPlugin
      const result = client.decide({
        context,
        defaults: stableDefaults,
      });

      // Only update state if we didn't already resolve synchronously
      // This prevents the params from flickering (default -> resolved)
      // But we ALWAYS call decide() to ensure tracking happens
      if (!resolvedSyncRef.current) {
        setParams(result.assignments as T);
      }
      setDecision(result);
      setHasTrackedExposure(false);
    } else {
      // Use getParams() - no tracking
      if (!resolvedSyncRef.current) {
        const resolved = client.getParams({
          context,
          defaults: stableDefaults,
        });
        setParams(resolved as T);
      }
      setDecision(null);
    }

    // Clear the sync flag after first effect run
    resolvedSyncRef.current = false;
  }, [client, ready, getContext, stableContext, stableDefaults, shouldTrackDecision]);

  // Auto-track exposure when tracking is "full"
  useEffect(() => {
    if (shouldAutoTrackExposure && decision && !hasTrackedExposure) {
      trackExposure();
    }
  }, [shouldAutoTrackExposure, decision, hasTrackedExposure, trackExposure]);

  // Ref to store current decision for stable track function reference
  const decisionRef = useRef<DecisionResult | null>(null);
  decisionRef.current = decision;

  // Buffer for track events that arrive before decision is ready
  // This prevents race conditions where track() is called in a useEffect
  // that runs before the decision has been set
  const pendingTracksRef = useRef<Array<{ event: string; properties?: Record<string, unknown> }>>([]);

  // Flush pending track events when decision becomes available
  useEffect(() => {
    if (decision && client && pendingTracksRef.current.length > 0) {
      const pending = pendingTracksRef.current;
      pendingTracksRef.current = [];
      
      for (const { event, properties } of pending) {
        client.track(event, properties, {
          decisionId: decision.decisionId,
          unitKey: getUnitKey(),
        });
      }
    }
  }, [decision, client, getUnitKey]);

  // Track user events - decisionId is automatically included
  // If decision isn't ready yet, events are queued and flushed when it becomes available
  const track = useCallback(
    (event: string, properties?: Record<string, unknown>) => {
      if (!client) {
        console.warn("[Traffical] Client not initialized, cannot track event");
        return;
      }
      
      const currentDecision = decisionRef.current;
      if (!currentDecision) {
        // Queue the event instead of dropping it - will be flushed when decision is ready
        // This handles the race condition where track() is called before decision is set
        if (trackingMode === "none") {
          console.warn(
            "[Traffical] Cannot track event with tracking: 'none'. Use tracking: 'full' or 'decision'."
          );
          return;
        }
        pendingTracksRef.current.push({ event, properties });
        return;
      }
      
      client.track(event, properties, {
        decisionId: currentDecision.decisionId,
        unitKey: getUnitKey(),
      });
    },
    [client, getUnitKey, trackingMode]
  );

  // Deprecated: Bound reward tracking - decisionId is automatically included
  const trackReward = useCallback(
    (options: BoundTrackRewardOptions) => {
      if (!client) {
        console.warn("[Traffical] Client not initialized, cannot track reward");
        return;
      }
      const currentDecision = decisionRef.current;
      if (!currentDecision) {
        console.warn(
          "[Traffical] No decision available, cannot track reward. Did you use tracking: 'none'?"
        );
        return;
      }
      // Map old API to new track() API
      track(options.rewardType || "reward", {
        value: options.reward,
        ...(options.rewards ? { rewards: options.rewards } : {}),
      });
    },
    [client, track]
  );

  return { params, decision, ready, error, trackExposure, track, trackReward };
}

// =============================================================================
// Deprecated Hooks (for backward compatibility)
// =============================================================================

/**
 * Options for useTrafficalParams hook.
 * @deprecated Use UseTrafficalOptions instead.
 */
export interface UseTrafficalParamsOptions<T extends Record<string, ParameterValue>> {
  /** Default values for parameters */
  defaults: T;
  /** Additional context to merge (optional) */
  context?: Context;
}

/**
 * Return value from useTrafficalParams hook.
 * @deprecated Use UseTrafficalResult instead.
 */
export interface UseTrafficalParamsResult<T> {
  /** Resolved parameter values */
  params: T;
  /** Whether the client is ready (config loaded) */
  ready: boolean;
  /** Any error that occurred */
  error: Error | null;
}

/**
 * Hook to get resolved parameter values.
 *
 * @deprecated Use `useTraffical({ tracking: "none" })` instead.
 *
 * @example
 * ```tsx
 * // Old way (deprecated)
 * const { params, ready } = useTrafficalParams({ defaults: { ... } });
 *
 * // New way
 * const { params, ready } = useTraffical({ defaults: { ... }, tracking: "none" });
 * ```
 */
export function useTrafficalParams<T extends Record<string, ParameterValue>>(
  options: UseTrafficalParamsOptions<T>
): UseTrafficalParamsResult<T> {
  // Show deprecation warning in development only
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        '[Traffical] useTrafficalParams is deprecated. Use useTraffical({ tracking: "none" }) instead.'
      );
    }
  }, []);

  const result = useTraffical({ ...options, tracking: "none" });
  return { params: result.params, ready: result.ready, error: result.error };
}

/**
 * Options for useTrafficalDecision hook.
 * @deprecated Use UseTrafficalOptions instead.
 */
export interface UseTrafficalDecisionOptions<T extends Record<string, ParameterValue>> {
  /** Default values for parameters */
  defaults: T;
  /** Additional context to merge (optional) */
  context?: Context;
  /**
   * Whether to automatically track exposure (default: true).
   * Set to false if you want to manually control when exposure is tracked
   * (e.g., when an element scrolls into view).
   *
   * Note: Decision tracking happens automatically via DecisionTrackingPlugin
   * and is separate from exposure tracking.
   */
  trackExposure?: boolean;
}

/**
 * Return value from useTrafficalDecision hook.
 * @deprecated Use UseTrafficalResult instead.
 */
export interface UseTrafficalDecisionResult<T> {
  /** Resolved parameter values */
  params: T;
  /** The full decision result (for tracking) */
  decision: DecisionResult | null;
  /** Whether the client is ready (config loaded) */
  ready: boolean;
  /** Any error that occurred */
  error: Error | null;
  /**
   * Function to manually track exposure.
   * Note: This is synchronous - events are batched internally.
   */
  trackExposure: () => void;
}

/**
 * Hook to get a decision with full metadata for tracking.
 *
 * @deprecated Use `useTraffical()` instead.
 *
 * @example
 * ```tsx
 * // Old way (deprecated)
 * const { params, decision } = useTrafficalDecision({ defaults: { ... } });
 *
 * // New way
 * const { params, decision } = useTraffical({ defaults: { ... } });
 *
 * // Old way with manual exposure (deprecated)
 * const { params, trackExposure } = useTrafficalDecision({ defaults: { ... }, trackExposure: false });
 *
 * // New way with manual exposure
 * const { params, trackExposure } = useTraffical({ defaults: { ... }, tracking: "decision" });
 * ```
 */
export function useTrafficalDecision<T extends Record<string, ParameterValue>>(
  options: UseTrafficalDecisionOptions<T>
): UseTrafficalDecisionResult<T> {
  // Show deprecation warning in development only
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "[Traffical] useTrafficalDecision is deprecated. Use useTraffical() instead."
      );
    }
  }, []);

  // Map old trackExposure option to new tracking mode
  const tracking = options.trackExposure === false ? "decision" : "full";
  return useTraffical({ defaults: options.defaults, context: options.context, tracking });
}

/**
 * Hook to track user events.
 *
 * @example
 * ```tsx
 * const track = useTrafficalTrack();
 *
 * const handlePurchase = (amount: number) => {
 *   track('purchase', { value: amount, orderId: 'ord_123' });
 * };
 * ```
 */
export function useTrafficalTrack() {
  const { client, getUnitKey } = useTrafficalContext();

  const track = useCallback(
    (
      event: string,
      properties?: Record<string, unknown>,
      options?: { decisionId?: string }
    ) => {
      if (!client) {
        console.warn("[Traffical] Client not initialized, cannot track event");
        return;
      }

      client.track(event, properties, {
        decisionId: options?.decisionId,
        unitKey: getUnitKey(),
      });
    },
    [client, getUnitKey]
  );

  return track;
}

/**
 * @deprecated Use useTrafficalTrack() instead.
 *
 * Hook to track a reward.
 *
 * @example
 * ```tsx
 * const trackReward = useTrafficalReward();
 *
 * const handlePurchase = (amount: number) => {
 *   trackReward({
 *     decisionId: decision.decisionId,
 *     reward: amount,
 *     rewardType: "revenue",
 *   });
 * };
 * ```
 */
export function useTrafficalReward() {
  const { client, getUnitKey, getContext } = useTrafficalContext();

  const trackReward = useCallback(
    (options: {
      decisionId: string;
      reward: number;
      rewardType?: string;
      rewards?: Record<string, number>;
    }) => {
      if (!client) {
        console.warn("[Traffical] Client not initialized, cannot track reward");
        return;
      }

      // Map old API to new track() API
      client.track(options.rewardType || "reward", {
        value: options.reward,
        ...(options.rewards ? { rewards: options.rewards } : {}),
      }, {
        decisionId: options.decisionId,
        unitKey: getUnitKey(),
      });
    },
    [client, getUnitKey, getContext]
  );

  return trackReward;
}

/**
 * Hook to access a registered plugin by name.
 *
 * @example
 * ```tsx
 * import { createDOMBindingPlugin, DOMBindingPlugin } from '@traffical/js-client';
 *
 * // In your provider config:
 * plugins: [createDOMBindingPlugin()]
 *
 * // In a component:
 * const domPlugin = useTrafficalPlugin<DOMBindingPlugin>('dom-binding');
 *
 * // Re-apply bindings after dynamic content changes
 * useEffect(() => {
 *   domPlugin?.applyBindings();
 * }, [contentLoaded, domPlugin]);
 * ```
 */
export function useTrafficalPlugin<T extends TrafficalPlugin = TrafficalPlugin>(
  name: string
): T | undefined {
  const { client, ready } = useTrafficalContext();

  if (!client || !ready) {
    return undefined;
  }

  return client.getPlugin(name) as T | undefined;
}

/**
 * Hook to access the Traffical client directly.
 *
 * @example
 * ```tsx
 * const { client, ready } = useTrafficalClient();
 *
 * if (ready && client) {
 *   const version = client.getConfigVersion();
 *   const stableId = client.getStableId();
 * }
 * ```
 */
export function useTrafficalClient() {
  const { client, ready, error } = useTrafficalContext();
  return { client, ready, error };
}
