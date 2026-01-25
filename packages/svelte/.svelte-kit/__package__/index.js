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
// =============================================================================
// Re-export from @traffical/core
// =============================================================================
export { 
// Resolution functions
resolveParameters, decide, evaluateCondition, evaluateConditions, 
// Hashing utilities
fnv1a, computeBucket, isInBucketRange, 
// ID generation
generateEventId, generateDecisionId, generateExposureId, generateRewardId, } from "@traffical/core";
// =============================================================================
// Re-export from @traffical/js-client
// =============================================================================
export { 
// Client
TrafficalClient, createTrafficalClient, createTrafficalClientSync, 
// Storage providers
LocalStorageProvider, MemoryStorageProvider, createStorageProvider, 
// Plugins
createDOMBindingPlugin, } from "@traffical/js-client";
// =============================================================================
// Svelte-specific exports
// =============================================================================
// Context
export { initTraffical, getTrafficalContext, hasTrafficalContext, } from "./context.svelte.js";
// Hooks
export { useTraffical, useTrafficalTrack, useTrafficalReward, useTrafficalClient, useTrafficalPlugin, } from "./hooks.svelte.js";
// Provider component
export { default as TrafficalProvider } from "./TrafficalProvider.svelte";
