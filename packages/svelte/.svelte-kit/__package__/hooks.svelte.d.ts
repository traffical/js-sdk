/**
 * @traffical/svelte - Hooks
 *
 * Svelte 5 hooks for parameter resolution and decision tracking.
 * Uses runes ($derived, $effect) for reactive, fine-grained updates.
 */
import type { ParameterValue } from "@traffical/core";
import type { TrafficalPlugin, TrafficalClient } from "@traffical/js-client";
import type { UseTrafficalOptions, UseTrafficalResult, TrackRewardOptions, TrackEventOptions } from "./types.js";
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
export declare function useTraffical<T extends Record<string, ParameterValue>>(options: UseTrafficalOptions<T>): UseTrafficalResult<T>;
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
export declare function useTrafficalTrack(): (options: TrackEventOptions) => void;
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
export declare function useTrafficalReward(): (options: TrackRewardOptions) => void;
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
export declare function useTrafficalClient(): {
    readonly client: TrafficalClient | null;
    readonly ready: boolean;
    readonly error: Error | null;
};
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
export declare function useTrafficalPlugin<T extends TrafficalPlugin = TrafficalPlugin>(name: string): T | undefined;
//# sourceMappingURL=hooks.svelte.d.ts.map