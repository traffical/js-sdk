/**
 * Global entry point for IIFE bundle.
 *
 * Exports `window.Traffical` for script tag usage:
 *
 * ```html
 * <script src="https://cdn.traffical.io/js-client/v1/traffical.min.js"></script>
 * <script>
 *   Traffical.init({ ... }).then(function(client) {
 *     var params = client.getParams({ ... });
 *   });
 * </script>
 * ```
 */

import {
  TrafficalClient,
  createTrafficalClient,
  createTrafficalClientSync,
  type TrafficalClientOptions,
} from "./client.js";
import type { TrafficalPlugin } from "./plugins/index.js";
import {
  createDOMBindingPlugin,
  type DOMBindingPlugin,
  type DOMBindingPluginOptions,
} from "./plugins/dom-binding.js";

// Global state for singleton pattern
let _instance: TrafficalClient | null = null;

/**
 * Initialize the Traffical client (async).
 * Returns the client instance.
 */
async function init(options: TrafficalClientOptions): Promise<TrafficalClient> {
  if (_instance) {
    console.warn("[Traffical] Client already initialized. Returning existing instance.");
    return _instance;
  }

  _instance = await createTrafficalClient(options);
  return _instance;
}

/**
 * Initialize the Traffical client (sync).
 * Returns the client instance immediately, but config fetch happens async.
 */
function initSync(options: TrafficalClientOptions): TrafficalClient {
  if (_instance) {
    console.warn("[Traffical] Client already initialized. Returning existing instance.");
    return _instance;
  }

  _instance = createTrafficalClientSync(options);

  // Start async initialization in background
  _instance.initialize().catch((error) => {
    console.warn("[Traffical] Initialization error:", error);
  });

  return _instance;
}

/**
 * Get the singleton client instance.
 * Returns null if not initialized.
 */
function instance(): TrafficalClient | null {
  return _instance;
}

/**
 * Destroy the singleton instance.
 */
function destroy(): void {
  if (_instance) {
    _instance.destroy();
    _instance = null;
  }
}

// Export the Traffical global object
export {
  init,
  initSync,
  instance,
  destroy,
  TrafficalClient,
  type TrafficalClientOptions,
  type TrafficalPlugin,
  // DOM binding plugin
  createDOMBindingPlugin,
  type DOMBindingPlugin,
  type DOMBindingPluginOptions,
};

