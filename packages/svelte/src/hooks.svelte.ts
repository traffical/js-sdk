/**
 * @traffical/svelte - Hooks
 *
 * Svelte 5 hooks for parameter resolution and decision tracking.
 * Uses $state with event-driven recomputation for cross-package reactivity.
 *
 * IMPORTANT — Reactivity & Destructuring:
 * `params` is returned as a deep $state proxy. Destructuring it is safe:
 *   const { params } = useTraffical({ defaults: { ... } });
 *   {params['my.key']}  // reactive ✅
 *
 * `decision`, `ready`, `error` are primitives/objects behind getters.
 * Access them through the returned object for reactivity:
 *   const t = useTraffical({ defaults: { ... } });
 *   {t.ready}      // reactive ✅
 *   {t.decision}   // reactive ✅
 */

import { resolveParameters, decide as coreDecide } from "@traffical/core";
import type {
  ParameterValue,
  DecisionResult,
  Context,
  TrackEventMap,
  TypedTrackFn,
} from "@traffical/core";
import type {
  TrafficalPlugin,
  TrafficalClient,
} from "@traffical/js-client";
import { getTrafficalContext } from "./context.svelte.js";
import type {
  UseTrafficalOptions,
  UseTrafficalResult,
  BoundTrackRewardOptions,
  TrackRewardOptions,
  TrackEventOptions,
} from "./types.js";

// =============================================================================
// Browser Detection
// =============================================================================

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

// =============================================================================
// useTraffical - Primary Hook
// =============================================================================

/**
 * Primary hook for Traffical parameter resolution and decision tracking.
 *
 * Returns reactive values that automatically update when the config bundle changes.
 * On first render, returns defaults immediately (no blocking).
 * When the config bundle loads, recomputes and returns resolved values.
 *
 * @example
 * ```svelte
 * <script>
 *   import { useTraffical } from '@traffical/svelte';
 *
 *   // Destructuring `params` is safe — it's a deep reactive proxy.
 *   // For `ready`/`decision`, access via the object for reactivity.
 *   const { params, trackExposure } = useTraffical({
 *     defaults: { "checkout.ctaText": "Buy Now" },
 *   });
 * </script>
 *
 * <button>{params['checkout.ctaText']}</button>
 * ```
 *
 * @example
 * ```svelte
 * <script>
 *   // Access decision/ready through the object (not destructured)
 *   const t = useTraffical({
 *     defaults: { "checkout.ctaText": "Buy Now" },
 *     tracking: "decision",
 *   });
 * </script>
 *
 * {#if t.ready}
 *   <button onclick={() => t.trackExposure()}>
 *     {t.params['checkout.ctaText']}
 *   </button>
 * {/if}
 * ```
 *
 * @example
 * ```svelte
 * <script>
 *   // No tracking - for SSR, tests, or internal logic
 *   const { params } = useTraffical({
 *     defaults: { "ui.hero.title": "Welcome" },
 *     tracking: "none",
 *   });
 * </script>
 * ```
 */
export function useTraffical<
  T extends Record<string, ParameterValue>,
  TEvents extends TrackEventMap = TrackEventMap,
>(
  options: UseTrafficalOptions<T>
): UseTrafficalResult<T, TEvents> {
  const ctx = getTrafficalContext();

  const trackingMode = options.tracking ?? "full";
  const shouldTrackDecision = trackingMode !== "none";
  const shouldAutoTrackExposure = trackingMode === "full";

  // Track whether we've already tracked exposure for this decision
  let hasTrackedExposure = $state(false);
  let currentDecisionId = $state<string | null>(null);

  // -------------------------------------------------------------------------
  // Params as deep $state proxy + Decision as $state
  //
  // We avoid $derived.by because when @traffical/svelte is consumed as a
  // linked or pre-bundled package, the Svelte runtime used by this file may
  // differ from the app's runtime, breaking dependency tracking.
  //
  // `params` is stored inside a deep $state proxy object. This means
  // destructuring is safe: `const { params } = useTraffical(...)` gives
  // the consumer a reference to the proxy, and property reads like
  // `params['feature.x']` are reactive. On recompute, we mutate the
  // proxy in-place via Object.assign rather than replacing it.
  // -------------------------------------------------------------------------

  function computeParams(): T {
    if (ctx.client && ctx.bundle) {
      return ctx.client.getParams({
        context: { ...ctx.getContext(), ...options.context },
        defaults: options.defaults,
      }) as T;
    }

    if (ctx.bundle) {
      const context: Context = {
        ...ctx.getContext(),
        ...options.context,
      };
      return resolveParameters(ctx.bundle, context, options.defaults);
    }

    if (ctx.initialParams) {
      return { ...options.defaults, ...ctx.initialParams } as T;
    }

    return options.defaults;
  }

  function computeDecision(): DecisionResult | null {
    if (!shouldTrackDecision) return null;
    if (!ctx.bundle) return null;

    const context: Context = {
      ...ctx.getContext(),
      ...options.context,
    };

    if (ctx.client) {
      return ctx.client.decide({ context, defaults: options.defaults });
    }

    return coreDecide(ctx.bundle, context, options.defaults);
  }

  // Deep $state proxy — params is a stable object reference that can be
  // destructured safely. Property mutations propagate to the template.
  const _paramsProxy = $state<{ current: T }>({ current: computeParams() });
  let decision = $state<DecisionResult | null>(computeDecision());

  function recompute() {
    // Mutate the proxy's properties in-place so destructured references
    // stay alive. Keys come from `defaults` and are constant per call site.
    const newParams = computeParams();
    const target = _paramsProxy.current as Record<string, ParameterValue>;
    for (const key of Object.keys(target)) {
      if (!(key in newParams)) {
        delete target[key];
      }
    }
    Object.assign(target, newParams);

    const newDecision = computeDecision();
    const newId = newDecision?.decisionId ?? null;
    if (newId !== currentDecisionId) {
      currentDecisionId = newId;
      hasTrackedExposure = false;
    }
    decision = newDecision;
  }

  // Subscribe to override and identity changes from the client
  if (ctx.client) {
    ctx.client.onOverridesChange(() => recompute());
    ctx.client.onIdentityChange(() => recompute());
  }

  // Auto-track exposure when tracking is "full" and decision is available
  $effect(() => {
    if (
      shouldAutoTrackExposure &&
      decision &&
      !hasTrackedExposure &&
      isBrowser()
    ) {
      trackExposureInternal();
    }
  });

  // Internal exposure tracking function
  function trackExposureInternal(): void {
    if (!isBrowser() || !ctx.client || !decision || hasTrackedExposure) {
      return;
    }

    ctx.client.trackExposure(decision);
    hasTrackedExposure = true;
  }

  // Public exposure tracking function
  function trackExposure(): void {
    if (trackingMode === "none") {
      return;
    }
    trackExposureInternal();
  }

  // Track user events - decisionId is automatically included
  function track(event: string, properties?: Record<string, unknown>): void {
    if (!isBrowser() || !ctx.client) {
      if (!isBrowser()) {
        return; // Silent no-op during SSR
      }
      console.warn("[Traffical] Client not initialized, cannot track event");
      return;
    }

    // Access the reactive decision value
    const currentDecision = decision;
    if (!currentDecision) {
      console.warn(
        "[Traffical] No decision available, cannot track event. Did you use tracking: 'none'?"
      );
      return;
    }

    ctx.client.track(event, properties, {
      decisionId: currentDecision.decisionId,
      unitKey: ctx.getUnitKey(),
    });
  }

  // Deprecated: Bound reward tracking - decisionId is automatically included
  function trackReward(options: BoundTrackRewardOptions): void {
    if (!isBrowser() || !ctx.client) {
      if (!isBrowser()) {
        return; // Silent no-op during SSR
      }
      console.warn("[Traffical] Client not initialized, cannot track reward");
      return;
    }

    // Access the reactive decision value
    const currentDecision = decision;
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
  }

  return {
    get params() {
      return _paramsProxy.current;
    },
    get decision() {
      return decision;
    },
    get ready() {
      return ctx.ready;
    },
    get error() {
      return ctx.error;
    },
    trackExposure,
    track: track as TypedTrackFn<TEvents>,
    trackReward,
  };
}

// =============================================================================
// useTrafficalTrack
// =============================================================================

/**
 * Hook to track user events.
 *
 * @example
 * ```svelte
 * <script>
 *   import { useTrafficalTrack } from '@traffical/svelte';
 *
 *   const track = useTrafficalTrack();
 *
 *   function handlePurchase(amount: number) {
 *     track({
 *       event: 'purchase',
 *       properties: { value: amount, orderId: 'ord_123' },
 *     });
 *   }
 * </script>
 * ```
 */
export function useTrafficalTrack<TEvents extends TrackEventMap = TrackEventMap>(): {
  <E extends Extract<keyof TEvents, string>>(options: {
    event: E;
    properties?: TEvents[E];
    decisionId?: string;
  }): void;
} {
  const ctx = getTrafficalContext();

  return function track(options: { event: string; properties?: Record<string, unknown>; decisionId?: string }): void {
    if (!isBrowser() || !ctx.client) {
      if (!isBrowser()) {
        return;
      }
      console.warn("[Traffical] Client not initialized, cannot track event");
      return;
    }

    ctx.client.track(options.event, options.properties, {
      decisionId: options.decisionId,
      unitKey: ctx.getUnitKey(),
    });
  } as any;
}

// =============================================================================
// useTrafficalReward (deprecated)
// =============================================================================

/**
 * @deprecated Use useTrafficalTrack() instead.
 *
 * Hook to track rewards (conversions, revenue, etc.).
 *
 * @example
 * ```svelte
 * <script>
 *   import { useTraffical, useTrafficalReward } from '@traffical/svelte';
 *
 *   const t = useTraffical({
 *     defaults: { 'checkout.ctaText': 'Buy Now' },
 *   });
 *
 *   const trackReward = useTrafficalReward();
 *
 *   function handlePurchase(amount: number) {
 *     trackReward({
 *       reward: amount,
 *       rewardType: 'revenue',
 *       decisionId: t.decision?.decisionId,
 *     });
 *   }
 * </script>
 * ```
 */
export function useTrafficalReward(): (options: TrackRewardOptions) => void {
  const ctx = getTrafficalContext();

  return function trackReward(options: TrackRewardOptions): void {
    if (!isBrowser() || !ctx.client) {
      if (!isBrowser()) {
        return; // Silent no-op during SSR
      }
      console.warn("[Traffical] Client not initialized, cannot track reward");
      return;
    }

    // We need to ensure decisionId is provided for the core TrackRewardOptions
    // If not provided, we skip tracking (can't attribute without decision)
    if (!options.decisionId) {
      console.warn("[Traffical] trackReward called without decisionId, skipping");
      return;
    }

    // Map old API to new track() API
    ctx.client.track(options.rewardType || "reward", {
      value: options.reward,
      ...(options.rewards ? { rewards: options.rewards } : {}),
    }, {
      decisionId: options.decisionId,
      unitKey: ctx.getUnitKey(),
    });
  };
}

// =============================================================================
// useTrafficalClient
// =============================================================================

/**
 * Hook to access the Traffical client directly.
 *
 * @example
 * ```svelte
 * <script>
 *   import { useTrafficalClient } from '@traffical/svelte';
 *
 *   const { client, ready, error } = useTrafficalClient();
 *
 *   $effect(() => {
 *     if (ready && client) {
 *       const version = client.getConfigVersion();
 *       const stableId = client.getStableId();
 *       console.log('Config version:', version, 'Stable ID:', stableId);
 *     }
 *   });
 * </script>
 * ```
 */
export function useTrafficalClient(): {
  readonly client: TrafficalClient | null;
  readonly ready: boolean;
  readonly error: Error | null;
} {
  const ctx = getTrafficalContext();

  return {
    get client() {
      return ctx.client;
    },
    get ready() {
      return ctx.ready;
    },
    get error() {
      return ctx.error;
    },
  };
}

// =============================================================================
// useTrafficalPlugin
// =============================================================================

/**
 * Hook to access a registered plugin by name.
 * Plugins are registered at initialization and don't change at runtime.
 *
 * @example
 * ```svelte
 * <script>
 *   import { useTrafficalPlugin } from '@traffical/svelte';
 *   import type { DOMBindingPlugin } from '@traffical/js-client';
 *
 *   const domPlugin = useTrafficalPlugin<DOMBindingPlugin>('dom-binding');
 *   domPlugin?.applyBindings();
 * </script>
 * ```
 */
export function useTrafficalPlugin<
  T extends TrafficalPlugin = TrafficalPlugin,
>(name: string): T | undefined {
  const ctx = getTrafficalContext();

  if (!ctx.client || !ctx.ready) {
    return undefined;
  }
  return ctx.client.getPlugin(name) as T | undefined;
}

