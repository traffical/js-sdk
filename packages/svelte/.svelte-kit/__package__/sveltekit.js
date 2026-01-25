/**
 * @traffical/svelte - SvelteKit Helpers
 *
 * Server-side utilities for SvelteKit load functions.
 * Enables SSR with pre-fetched config bundles.
 */
import { resolveParameters } from "@traffical/core";
// =============================================================================
// Constants
// =============================================================================
const DEFAULT_BASE_URL = "https://sdk.traffical.io";
// =============================================================================
// Load Functions
// =============================================================================
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
export async function loadTrafficalBundle(options) {
    const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    const url = `${baseUrl}/v1/config/${options.projectId}?env=${options.env}`;
    try {
        const response = await options.fetch(url, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${options.apiKey}`,
            },
        });
        if (!response.ok) {
            return {
                bundle: null,
                error: `HTTP ${response.status}: ${response.statusText}`,
            };
        }
        const bundle = (await response.json());
        return { bundle };
    }
    catch (err) {
        return {
            bundle: null,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}
// =============================================================================
// SSR Resolution
// =============================================================================
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
export function resolveParamsSSR(bundle, context, defaults) {
    if (!bundle) {
        return defaults;
    }
    return resolveParameters(bundle, context, defaults);
}
