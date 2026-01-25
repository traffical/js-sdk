/**
 * @traffical/react
 *
 * Traffical SDK for React applications.
 * Provides Provider and hooks for parameter resolution and decision tracking.
 *
 * Features:
 * - Browser-optimized with sendBeacon, localStorage persistence
 * - Automatic stable ID for anonymous users
 * - Plugin system support (DecisionTrackingPlugin enabled by default)
 * - Decision and exposure deduplication
 *
 * @example
 * ```tsx
 * import { TrafficalProvider, useTraffical } from '@traffical/react';
 *
 * function App() {
 *   return (
 *     <TrafficalProvider
 *       config={{
 *         orgId: 'org_123',
 *         projectId: 'proj_456',
 *         env: 'production',
 *         apiKey: 'pk_...',
 *       }}
 *     >
 *       <MyComponent />
 *     </TrafficalProvider>
 *   );
 * }
 *
 * function MyComponent() {
 *   const { params, ready } = useTraffical({
 *     defaults: { 'ui.hero.title': 'Welcome' },
 *   });
 *
 *   if (!ready) return <div>Loading...</div>;
 *   return <h1>{params['ui.hero.title']}</h1>;
 * }
 * ```
 */

// Re-export everything from core
export * from "@traffical/core";

// Re-export client and utilities from JS Client
export {
  TrafficalClient,
  createTrafficalClient,
  createTrafficalClientSync,
  type TrafficalClientOptions,
} from "@traffical/js-client";

// Re-export plugin utilities from JS Client
export {
  type TrafficalPlugin,
  type PluginOptions,
  createDOMBindingPlugin,
  type DOMBindingPlugin,
  type DOMBindingPluginOptions,
} from "@traffical/js-client";

// Export React-specific components and hooks
export { TrafficalProvider, type TrafficalProviderProps } from "./provider.js";

export {
  TrafficalContext,
  useTrafficalContext,
  type TrafficalProviderConfig,
  type TrafficalContextValue,
} from "./context.js";

export {
  // Primary hook
  useTraffical,
  type UseTrafficalOptions,
  type UseTrafficalResult,
  type BoundTrackOptions,
  // Track hook
  useTrafficalTrack,
  // Other hooks
  useTrafficalPlugin,
  useTrafficalClient,
  // Deprecated (kept for backward compatibility)
  type BoundTrackRewardOptions,
  useTrafficalReward,
  useTrafficalParams,
  useTrafficalDecision,
  type UseTrafficalParamsOptions,
  type UseTrafficalParamsResult,
  type UseTrafficalDecisionOptions,
  type UseTrafficalDecisionResult,
} from "./hooks.js";
