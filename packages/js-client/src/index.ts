/**
 * @traffical/js-client
 *
 * Traffical JavaScript SDK for browser environments.
 *
 * Features:
 * - Error boundary wrapping (P0) - SDK errors never crash your app
 * - Exposure deduplication (P0) - Same user/variant = 1 exposure
 * - Smart event batching (P1) - Batches events, uses sendBeacon on unload
 * - Plugin system (P2) - Extensible via plugins
 * - DOM binding plugin - Auto-apply parameters to DOM elements
 * - Auto stable ID - Anonymous user identification
 *
 * @example
 * ```typescript
 * import { createTrafficalClient, createDOMBindingPlugin } from '@traffical/js-client';
 *
 * const traffical = await createTrafficalClient({
 *   orgId: 'org_123',
 *   projectId: 'proj_456',
 *   env: 'production',
 *   apiKey: 'pk_...',
 *   plugins: [createDOMBindingPlugin()],
 * });
 *
 * const params = traffical.getParams({
 *   context: { userId: 'user_789' },
 *   defaults: { 'ui.button.color': '#000' },
 * });
 * ```
 */

// Re-export everything from core
export * from "@traffical/core";

// Export client
export {
  TrafficalClient,
  createTrafficalClient,
  createTrafficalClientSync,
  type TrafficalClientOptions,
} from "./client.js";

// Export components for advanced usage
export { ErrorBoundary, type ErrorBoundaryOptions } from "./error-boundary.js";
export { EventLogger, type EventLoggerOptions } from "./event-logger.js";
export { ExposureDeduplicator, type ExposureDeduplicatorOptions } from "./exposure-dedup.js";
export { StableIdProvider, type StableIdProviderOptions } from "./stable-id.js";
export {
  createStorageProvider,
  LocalStorageProvider,
  MemoryStorageProvider,
  type StorageProvider,
} from "./storage.js";

// Export plugin system
export { PluginManager, type TrafficalPlugin, type PluginOptions } from "./plugins/index.js";

// Export DOM binding plugin
export {
  createDOMBindingPlugin,
  type DOMBindingPlugin,
  type DOMBindingPluginOptions,
} from "./plugins/dom-binding.js";

