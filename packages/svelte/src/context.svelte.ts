/**
 * @traffical/svelte - Context Layer
 *
 * SSR-safe context management using Svelte 5 runes and Svelte's context API.
 * Initializes the TrafficalClient with environment-appropriate providers.
 */

import { getContext, setContext } from "svelte";
import {
  TrafficalClient,
  createTrafficalClientSync,
  MemoryStorageProvider,
  LocalStorageProvider,
} from "@traffical/js-client";
import type { Context as TrafficalContext } from "@traffical/core";
import type {
  TrafficalProviderConfig,
  TrafficalContextValue,
} from "./types.js";

// =============================================================================
// Constants
// =============================================================================

const TRAFFICAL_CONTEXT_KEY = Symbol("traffical");

// =============================================================================
// Browser Detection
// =============================================================================

/**
 * Check if we're running in a browser environment.
 * SSR-safe - returns false during server-side rendering.
 */
function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

// =============================================================================
// Context State Factory
// =============================================================================

/**
 * Creates the reactive Traffical context state.
 * Uses $state for reactive properties that work with SSR.
 */
function createTrafficalContextState(
  config: TrafficalProviderConfig
): TrafficalContextValue {
  // Reactive state using Svelte 5 runes
  let client = $state<TrafficalClient | null>(null);
  let ready = $state(!!config.initialBundle); // Ready immediately if we have initial bundle
  let error = $state<Error | null>(null);
  let bundle = $state(config.initialBundle ?? null);

  // Initialize client only in browser
  // NOTE: We create the client but DO NOT call initialize() here.
  // initialize() triggers fetch(), which causes SSR warnings.
  // The TrafficalProvider component will call initializeClient() after mount.
  if (isBrowser()) {
    // Use localStorage in browser, memory storage would lose data
    const storage = new LocalStorageProvider();

    const clientInstance = createTrafficalClientSync({
      orgId: config.orgId,
      projectId: config.projectId,
      env: config.env,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      localConfig: config.initialBundle ?? config.localConfig,
      refreshIntervalMs: config.refreshIntervalMs,
      storage,
      // Decision tracking options
      trackDecisions: config.trackDecisions,
      decisionDeduplicationTtlMs: config.decisionDeduplicationTtlMs,
      // Exposure options
      exposureSessionTtlMs: config.exposureSessionTtlMs,
      // Event batching options
      eventBatchSize: config.eventBatchSize,
      eventFlushIntervalMs: config.eventFlushIntervalMs,
      // Plugins
      plugins: config.plugins,
    });

    client = clientInstance;
    
    // If we have initial bundle, mark as ready immediately (no fetch needed for initial render)
    if (config.initialBundle) {
      ready = true;
    }
  } else {
    // On server, use memory storage and mark as ready if we have initial data
    // The client won't actually be used for tracking on server
    if (config.initialBundle) {
      const storage = new MemoryStorageProvider();
      const clientInstance = createTrafficalClientSync({
        orgId: config.orgId,
        projectId: config.projectId,
        env: config.env,
        apiKey: config.apiKey,
        localConfig: config.initialBundle,
        storage,
        // Disable background operations on server
        refreshIntervalMs: 0,
      });
      client = clientInstance;
      ready = true;
    }
  }

  // Unit key getter - uses config function or client's stable ID
  function getUnitKey(): string {
    if (config.unitKeyFn) {
      return config.unitKeyFn();
    }
    // Fall back to client's auto-generated stable ID
    return client?.getStableId() ?? "";
  }

  // Context getter - merges unit key with additional context
  function getContext(): TrafficalContext {
    const unitKey = getUnitKey();
    const additionalContext = config.contextFn?.() ?? {};

    return {
      ...additionalContext,
      // Include common unit key field names for compatibility
      userId: unitKey,
      deviceId: unitKey,
      anonymousId: unitKey,
    };
  }

  /**
   * Initializes the client by fetching config.
   * Should be called from onMount/effect to avoid SSR fetch warnings.
   */
  async function initializeClient(): Promise<void> {
    if (!client) return;
    
    try {
      await client.initialize();
      ready = true;
    } catch (err: unknown) {
      error = err instanceof Error ? err : new Error(String(err));
      // Still mark as ready - we'll use defaults/initial bundle
      ready = true;
    }
  }

  return {
    get client() {
      return client;
    },
    get ready() {
      return ready;
    },
    get error() {
      return error;
    },
    get bundle() {
      return bundle;
    },
    getUnitKey,
    getContext,
    initializeClient,
    initialParams: config.initialParams,
  };
}

// =============================================================================
// Public API
// =============================================================================

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
export function initTraffical(
  config: TrafficalProviderConfig
): TrafficalContextValue {
  const contextValue = createTrafficalContextState(config);
  setContext(TRAFFICAL_CONTEXT_KEY, contextValue);
  return contextValue;
}

/**
 * Gets the Traffical context value.
 * Must be called within a component tree where initTraffical() has been called.
 *
 * @throws Error if called outside of Traffical context
 */
export function getTrafficalContext(): TrafficalContextValue {
  const context = getContext<TrafficalContextValue | undefined>(
    TRAFFICAL_CONTEXT_KEY
  );

  if (!context) {
    throw new Error(
      "getTrafficalContext() must be called within a component tree where initTraffical() has been called. " +
        "Make sure to call initTraffical() in your root layout or wrap your app with <TrafficalProvider>."
    );
  }

  return context;
}

/**
 * Checks if Traffical context is available.
 * Useful for conditional rendering or optional Traffical integration.
 */
export function hasTrafficalContext(): boolean {
  try {
    const context = getContext<TrafficalContextValue | undefined>(
      TRAFFICAL_CONTEXT_KEY
    );
    return context !== undefined;
  } catch {
    return false;
  }
}

