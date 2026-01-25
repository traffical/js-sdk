/**
 * @traffical/svelte - SvelteKit Helpers
 *
 * Server-side utilities for SvelteKit load functions.
 * Enables SSR with pre-fetched config bundles.
 */
import type { ConfigBundle, Context, ParameterValue } from "@traffical/core";
import type { LoadTrafficalBundleOptions, LoadTrafficalBundleResult } from "./types.js";
/**
 * Loads the Traffical config bundle in a SvelteKit load function.
 *
 * Call this in your +layout.server.ts or +page.server.ts to fetch the config
 * bundle on the server, enabling SSR without FOOC (Flash of Original Content).
 *
 * @example
 * ```typescript
 * // src/routes/+layout.server.ts
 * import { loadTrafficalBundle } from '@traffical/svelte/sveltekit';
 * import { TRAFFICAL_API_KEY } from '$env/static/private';
 *
 * export async function load({ fetch }) {
 *   const { bundle } = await loadTrafficalBundle({
 *     orgId: 'org_123',
 *     projectId: 'proj_456',
 *     env: 'production',
 *     apiKey: TRAFFICAL_API_KEY,
 *     fetch,
 *   });
 *
 *   return {
 *     traffical: { bundle },
 *   };
 * }
 * ```
 */
export declare function loadTrafficalBundle(options: LoadTrafficalBundleOptions): Promise<LoadTrafficalBundleResult>;
/**
 * Resolves parameters on the server for SSR.
 *
 * Use this to pre-resolve specific parameters in your load function,
 * enabling server-side rendering with the correct values.
 *
 * @example
 * ```typescript
 * // src/routes/checkout/+page.server.ts
 * import { loadTrafficalBundle, resolveParamsSSR } from '@traffical/svelte/sveltekit';
 *
 * export async function load({ fetch, cookies }) {
 *   const { bundle } = await loadTrafficalBundle({ ... });
 *
 *   // Get user context from cookies/session
 *   const userId = cookies.get('userId');
 *
 *   // Pre-resolve params for this page
 *   const checkoutParams = resolveParamsSSR(
 *     bundle,
 *     { userId },
 *     {
 *       'checkout.ctaText': 'Buy Now',
 *       'checkout.ctaColor': '#000',
 *     }
 *   );
 *
 *   return {
 *     traffical: { bundle },
 *     checkoutParams,
 *   };
 * }
 * ```
 */
export declare function resolveParamsSSR<T extends Record<string, ParameterValue>>(bundle: ConfigBundle | null, context: Context, defaults: T): T;
export type { LoadTrafficalBundleOptions, LoadTrafficalBundleResult };
//# sourceMappingURL=sveltekit.d.ts.map