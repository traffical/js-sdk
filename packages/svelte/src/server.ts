/**
 * @traffical/svelte - Server-side utilities
 *
 * Re-exports @traffical/node for SvelteKit server-side usage.
 * Use this in hooks.server.ts, +server.ts, and +page.server.ts.
 *
 * @example
 * ```typescript
 * // hooks.server.ts - Singleton server client
 * import { createTrafficalClient } from '@traffical/svelte/server';
 * import { TRAFFICAL_API_KEY } from '$env/static/private';
 *
 * const traffical = await createTrafficalClient({
 *   orgId: 'org_123',
 *   projectId: 'proj_456',
 *   env: 'production',
 *   apiKey: TRAFFICAL_API_KEY,
 * });
 *
 * export const handle = async ({ event, resolve }) => {
 *   event.locals.traffical = traffical;
 *   return resolve(event);
 * };
 * ```
 *
 * @example
 * ```typescript
 * // +page.server.ts - Use the client
 * export async function load({ locals, cookies }) {
 *   const userId = cookies.get('userId');
 *
 *   const decision = locals.traffical.decide({
 *     context: { userId },
 *     defaults: { 'checkout.cta': 'Buy Now' },
 *   });
 *
 *   return { params: decision.values };
 * }
 * ```
 */

// =============================================================================
// Re-export from @traffical/node
// =============================================================================

export {
  // Client
  TrafficalClient,
  createTrafficalClient,
  createTrafficalClientSync,
} from "@traffical/node";

// =============================================================================
// Re-export SvelteKit-specific helpers
// =============================================================================

export { loadTrafficalBundle, resolveParamsSSR } from "./sveltekit.js";

// =============================================================================
// Types
// =============================================================================

export type { TrafficalClientOptions } from "@traffical/node";
export type {
  LoadTrafficalBundleOptions,
  LoadTrafficalBundleResult,
} from "./types.js";

