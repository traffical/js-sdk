/**
 * DOM Binding Plugin
 *
 * Automatically applies parameter values to DOM elements based on bindings
 * configured in Traffical via the visual editor.
 *
 * Features:
 * - URL pattern matching to apply bindings only on matching pages
 * - MutationObserver for dynamic content (SPA support)
 * - Supports multiple property types: innerHTML, textContent, src, href, style.*
 *
 * @example
 * ```typescript
 * import { createTrafficalClient, createDOMBindingPlugin } from '@traffical/js-client';
 *
 * const client = await createTrafficalClient({
 *   // ... config
 *   plugins: [createDOMBindingPlugin()],
 * });
 * ```
 */

import type { ConfigBundle, BundleDOMBinding, ParameterValue } from "@traffical/core";
import type { TrafficalPlugin } from "./types.js";

// =============================================================================
// Types
// =============================================================================

export interface DOMBindingPluginOptions {
  /**
   * Whether to start observing DOM mutations automatically.
   * Useful for SPAs where content is dynamically loaded.
   * @default true
   */
  observeMutations?: boolean;

  /**
   * Debounce time in ms for mutation-triggered reapplication.
   * @default 100
   */
  debounceMs?: number;
}

// =============================================================================
// DOM Binding Plugin
// =============================================================================

/**
 * Creates a DOM binding plugin instance.
 *
 * This plugin applies parameter values to DOM elements based on bindings
 * defined via the visual editor.
 */
export function createDOMBindingPlugin(
  options: DOMBindingPluginOptions = {}
): TrafficalPlugin & { applyBindings: (params?: Record<string, unknown>) => void; getBindings: () => BundleDOMBinding[] } {
  const config = {
    observeMutations: options.observeMutations ?? true,
    debounceMs: options.debounceMs ?? 100,
  };

  // Internal state
  let bindings: BundleDOMBinding[] = [];
  let lastParams: Record<string, unknown> = {};
  let observer: MutationObserver | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // ==========================================================================
  // Core binding logic
  // ==========================================================================

  /**
   * Check if URL matches the binding's pattern.
   */
  function matchesUrlPattern(pattern: string, path: string): boolean {
    try {
      const regex = new RegExp(pattern);
      return regex.test(path);
    } catch {
      // Invalid regex - fall back to exact match
      return path === pattern;
    }
  }

  /**
   * Set a property on an element.
   * Supports: innerHTML, textContent, src, href, style.*
   */
  function setProperty(element: HTMLElement, property: string, value: string): void {
    if (property === "innerHTML") {
      element.innerHTML = value;
    } else if (property === "textContent") {
      element.textContent = value;
    } else if (property === "src" && "src" in element) {
      (element as HTMLImageElement).src = value;
    } else if (property === "href" && "href" in element) {
      (element as HTMLAnchorElement).href = value;
    } else if (property.startsWith("style.")) {
      const styleProp = property.slice(6); // Remove "style." prefix
      (element.style as unknown as Record<string, string>)[styleProp] = value;
    } else {
      // Generic attribute setter for other properties
      element.setAttribute(property, value);
    }
  }

  /**
   * Apply a single binding to matching elements.
   */
  function applyBinding(binding: BundleDOMBinding, value: unknown): void {
    const stringValue = String(value);

    try {
      const elements = document.querySelectorAll(binding.selector);

      for (const element of elements) {
        setProperty(element as HTMLElement, binding.property, stringValue);
      }
    } catch (error) {
      // Invalid selector or other DOM error - silently warn
      console.warn(
        `[Traffical DOM Binding] Failed to apply binding for ${binding.parameterKey}:`,
        error
      );
    }
  }

  /**
   * Apply parameter values to matching DOM elements.
   */
  function apply(params: Record<string, unknown>, forceAll = false): void {
    lastParams = params;

    const currentPath = typeof window !== "undefined" ? window.location.pathname : "";

    for (const binding of bindings) {
      // Check URL pattern match
      if (!forceAll && !matchesUrlPattern(binding.urlPattern, currentPath)) {
        continue;
      }

      // Get parameter value
      const value = params[binding.parameterKey];
      if (value === undefined) {
        continue;
      }

      // Apply to matching elements
      applyBinding(binding, value);
    }
  }

  /**
   * Debounced reapplication of bindings after DOM mutations.
   */
  function debouncedApply(): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      apply(lastParams);
    }, config.debounceMs);
  }

  /**
   * Start observing DOM mutations.
   */
  function startObserving(): void {
    if (observer || typeof MutationObserver === "undefined" || typeof document === "undefined") {
      return;
    }

    observer = new MutationObserver(() => {
      debouncedApply();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * Stop observing DOM mutations.
   */
  function stopObserving(): void {
    if (observer) {
      observer.disconnect();
      observer = null;
    }

    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  // ==========================================================================
  // Plugin implementation
  // ==========================================================================

  return {
    name: "dom-binding",

    onInitialize() {
      // Start observing if enabled
      if (config.observeMutations) {
        startObserving();
      }
    },

    onConfigUpdate(bundle: ConfigBundle) {
      // Update bindings from bundle
      bindings = bundle.domBindings ?? [];
    },

    onResolve(params: Record<string, ParameterValue>) {
      // Apply bindings after parameters are resolved
      apply(params as Record<string, unknown>);
    },

    onDecision(decision) {
      // Also apply after decide() calls
      apply(decision.assignments as Record<string, unknown>);
    },

    onDestroy() {
      stopObserving();
      bindings = [];
      lastParams = {};
    },

    // ==========================================================================
    // Public API (exposed on plugin instance)
    // ==========================================================================

    /**
     * Manually apply DOM bindings with the given parameter values.
     * Use this to re-trigger bindings after dynamic content changes.
     *
     * @param params - Parameter values to apply. If omitted, uses last known params.
     */
    applyBindings(params?: Record<string, unknown>): void {
      if (params) {
        apply(params);
      } else {
        apply(lastParams);
      }
    },

    /**
     * Get the current DOM bindings from the config bundle.
     */
    getBindings(): BundleDOMBinding[] {
      return bindings;
    },
  };
}

// Type for the plugin with its public API
export type DOMBindingPlugin = ReturnType<typeof createDOMBindingPlugin>;

