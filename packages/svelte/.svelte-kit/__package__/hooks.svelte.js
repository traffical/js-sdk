/**
 * @traffical/svelte - Hooks
 *
 * Svelte 5 hooks for parameter resolution and decision tracking.
 * Uses runes ($derived, $effect) for reactive, fine-grained updates.
 */
import { resolveParameters, decide as coreDecide } from "@traffical/core";
import { getTrafficalContext } from "./context.svelte.js";
// =============================================================================
// Browser Detection
// =============================================================================
function isBrowser() {
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
 *   // Full tracking (default) - decision + exposure events
 *   const { params, decision, ready } = useTraffical({
 *     defaults: { "checkout.ctaText": "Buy Now" },
 *   });
 * </script>
 *
 * {#if ready}
 *   <button>{params['checkout.ctaText']}</button>
 * {:else}
 *   <button disabled>Loading...</button>
 * {/if}
 * ```
 *
 * @example
 * ```svelte
 * <script>
 *   // Decision tracking only - manual exposure control
 *   const { params, decision, trackExposure } = useTraffical({
 *     defaults: { "checkout.ctaText": "Buy Now" },
 *     tracking: "decision",
 *   });
 *
 *   // Track exposure when element becomes visible
 *   function handleVisible() {
 *     trackExposure();
 *   }
 * </script>
 * ```
 *
 * @example
 * ```svelte
 * <script>
 *   // No tracking - for SSR, tests, or internal logic
 *   const { params, ready } = useTraffical({
 *     defaults: { "ui.hero.title": "Welcome" },
 *     tracking: "none",
 *   });
 * </script>
 * ```
 */
export function useTraffical(options) {
    const ctx = getTrafficalContext();
    const trackingMode = options.tracking ?? "full";
    const shouldTrackDecision = trackingMode !== "none";
    const shouldAutoTrackExposure = trackingMode === "full";
    // Track whether we've already tracked exposure for this decision
    let hasTrackedExposure = $state(false);
    let currentDecisionId = $state(null);
    // Derive params reactively using $derived.by
    // This is synchronous and provides fine-grained reactivity
    const params = $derived.by(() => {
        // Priority 1: Resolve from bundle if available
        if (ctx.bundle) {
            const context = {
                ...ctx.getContext(),
                ...options.context,
            };
            return resolveParameters(ctx.bundle, context, options.defaults);
        }
        // Priority 2: Use server-provided initial params
        if (ctx.initialParams) {
            return { ...options.defaults, ...ctx.initialParams };
        }
        // Priority 3: Fall back to defaults
        return options.defaults;
    });
    // Derive decision reactively
    const decision = $derived.by(() => {
        if (!shouldTrackDecision) {
            return null;
        }
        if (!ctx.bundle) {
            return null;
        }
        const context = {
            ...ctx.getContext(),
            ...options.context,
        };
        // Use client's decide if available (handles tracking internally)
        if (ctx.client) {
            return ctx.client.decide({
                context,
                defaults: options.defaults,
            });
        }
        // Fall back to core decide (SSR or no client)
        return coreDecide(ctx.bundle, context, options.defaults);
    });
    // Reset exposure tracking when decision changes
    $effect(() => {
        const decisionId = decision?.decisionId ?? null;
        if (decisionId !== currentDecisionId) {
            currentDecisionId = decisionId;
            hasTrackedExposure = false;
        }
    });
    // Auto-track exposure when tracking is "full" and decision is available
    $effect(() => {
        if (shouldAutoTrackExposure &&
            decision &&
            !hasTrackedExposure &&
            isBrowser()) {
            trackExposureInternal();
        }
    });
    // Internal exposure tracking function
    function trackExposureInternal() {
        if (!isBrowser() || !ctx.client || !decision || hasTrackedExposure) {
            return;
        }
        ctx.client.trackExposure(decision);
        hasTrackedExposure = true;
    }
    // Public exposure tracking function
    function trackExposure() {
        if (trackingMode === "none") {
            return;
        }
        trackExposureInternal();
    }
    // Track user events - decisionId is automatically included
    function track(event, properties) {
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
            console.warn("[Traffical] No decision available, cannot track event. Did you use tracking: 'none'?");
            return;
        }
        ctx.client.track(event, properties, {
            decisionId: currentDecision.decisionId,
            unitKey: ctx.getUnitKey(),
        });
    }
    // Deprecated: Bound reward tracking - decisionId is automatically included
    function trackReward(options) {
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
            console.warn("[Traffical] No decision available, cannot track reward. Did you use tracking: 'none'?");
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
            return params;
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
        track,
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
export function useTrafficalTrack() {
    const ctx = getTrafficalContext();
    return function track(options) {
        if (!isBrowser() || !ctx.client) {
            if (!isBrowser()) {
                return; // Silent no-op during SSR
            }
            console.warn("[Traffical] Client not initialized, cannot track event");
            return;
        }
        ctx.client.track(options.event, options.properties, {
            decisionId: options.decisionId,
            unitKey: ctx.getUnitKey(),
        });
    };
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
 *   const { params, decision } = useTraffical({
 *     defaults: { 'checkout.ctaText': 'Buy Now' },
 *   });
 *
 *   const trackReward = useTrafficalReward();
 *
 *   function handlePurchase(amount: number) {
 *     trackReward({
 *       reward: amount,
 *       rewardType: 'revenue',
 *     });
 *   }
 * </script>
 * ```
 */
export function useTrafficalReward() {
    const ctx = getTrafficalContext();
    return function trackReward(options) {
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
export function useTrafficalClient() {
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
 *
 * @example
 * ```svelte
 * <script>
 *   import { useTrafficalPlugin } from '@traffical/svelte';
 *   import type { DOMBindingPlugin } from '@traffical/js-client';
 *
 *   const domPlugin = useTrafficalPlugin<DOMBindingPlugin>('dom-binding');
 *
 *   // Re-apply bindings after dynamic content changes
 *   $effect(() => {
 *     if (contentLoaded) {
 *       domPlugin?.applyBindings();
 *     }
 *   });
 * </script>
 * ```
 */
export function useTrafficalPlugin(name) {
    const ctx = getTrafficalContext();
    // Derive plugin access reactively
    const plugin = $derived.by(() => {
        if (!ctx.client || !ctx.ready) {
            return undefined;
        }
        return ctx.client.getPlugin(name);
    });
    return plugin;
}
