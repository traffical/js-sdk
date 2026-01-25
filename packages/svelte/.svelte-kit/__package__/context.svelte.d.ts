/**
 * @traffical/svelte - Context Layer
 *
 * SSR-safe context management using Svelte 5 runes and Svelte's context API.
 * Initializes the TrafficalClient with environment-appropriate providers.
 */
import type { TrafficalProviderConfig, TrafficalContextValue } from "./types.js";
/**
 * Initializes the Traffical context.
 * Must be called at the root of your application (e.g., in +layout.svelte).
 *
 * @example
 * ```svelte
 * <script>
 *   import { initTraffical } from '@traffical/svelte';
 *
 *   let { data, children } = $props();
 *
 *   initTraffical({
 *     orgId: 'org_123',
 *     projectId: 'proj_456',
 *     env: 'production',
 *     apiKey: 'pk_...',
 *     initialBundle: data.traffical?.bundle,
 *   });
 * </script>
 *
 * {@render children()}
 * ```
 */
export declare function initTraffical(config: TrafficalProviderConfig): TrafficalContextValue;
/**
 * Gets the Traffical context value.
 * Must be called within a component tree where initTraffical() has been called.
 *
 * @throws Error if called outside of Traffical context
 */
export declare function getTrafficalContext(): TrafficalContextValue;
/**
 * Checks if Traffical context is available.
 * Useful for conditional rendering or optional Traffical integration.
 */
export declare function hasTrafficalContext(): boolean;
//# sourceMappingURL=context.svelte.d.ts.map