/**
 * @traffical/svelte
 *
 * Traffical SDK for Svelte 5 applications.
 * Provides Provider component and hooks for parameter resolution and decision tracking.
 *
 * Features:
 * - Full SSR/hydration support for SvelteKit
 * - Svelte 5 runes for reactive, fine-grained updates
 * - Browser-optimized with sendBeacon, localStorage persistence
 * - Automatic stable ID for anonymous users
 * - Plugin system support (DecisionTrackingPlugin enabled by default)
 * - Decision and exposure deduplication
 *
 * @example
 * ```svelte
 * <!-- +layout.svelte -->
 * <script>
 *   import { TrafficalProvider } from '@traffical/svelte';
 *
 *   let { data, children } = $props();
 * </script>
 *
 * <TrafficalProvider
 *   config={{
 *     orgId: 'org_123',
 *     projectId: 'proj_456',
 *     env: 'production',
 *     apiKey: 'pk_...',
 *     initialBundle: data.traffical?.bundle,
 *   }}
 * >
 *   {@render children()}
 * </TrafficalProvider>
 * ```
 *
 * @example
 * ```svelte
 * <!-- MyComponent.svelte -->
 * <script>
 *   import { useTraffical } from '@traffical/svelte';
 *
 *   const { params, ready } = useTraffical({
 *     defaults: { 'ui.hero.title': 'Welcome' },
 *   });
 * </script>
 *
 * {#if ready}
 *   <h1>{params['ui.hero.title']}</h1>
 * {:else}
 *   <h1>Loading...</h1>
 * {/if}
 * ```
 */
export { resolveParameters, decide, evaluateCondition, evaluateConditions, fnv1a, computeBucket, isInBucketRange, generateEventId, generateDecisionId, generateExposureId, generateRewardId, } from "@traffical/core";
export { TrafficalClient, createTrafficalClient, createTrafficalClientSync, LocalStorageProvider, MemoryStorageProvider, createStorageProvider, createDOMBindingPlugin, } from "@traffical/js-client";
export { initTraffical, getTrafficalContext, hasTrafficalContext, } from "./context.svelte.js";
export { useTraffical, useTrafficalTrack, useTrafficalReward, useTrafficalClient, useTrafficalPlugin, } from "./hooks.svelte.js";
export { default as TrafficalProvider } from "./TrafficalProvider.svelte";
export type { TrafficalProviderConfig, TrafficalContextValue, UseTrafficalOptions, UseTrafficalResult, BoundTrackOptions, TrackEventOptions, BoundTrackRewardOptions, TrackRewardOptions, LoadTrafficalBundleOptions, LoadTrafficalBundleResult, ConfigBundle, Context, DecisionResult, ParameterValue, TrafficalClient as TrafficalClientType, TrafficalPlugin, } from "./types.js";
//# sourceMappingURL=index.d.ts.map