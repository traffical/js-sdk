/**
 * PluginManager - Manages plugin lifecycle and hook execution.
 *
 * Provides a minimal hook-based system for extending SDK functionality.
 */

import type {
  ConfigBundle,
  DecisionResult,
  ExposureEvent,
  TrackEvent,
  Context,
  ParameterValue,
} from "@traffical/core";
import type { TrafficalPlugin, PluginOptions } from "./types.js";

interface RegisteredPlugin {
  plugin: TrafficalPlugin;
  priority: number;
}

export class PluginManager {
  private _plugins: RegisteredPlugin[] = [];

  /**
   * Register a plugin.
   */
  register(options: PluginOptions | TrafficalPlugin): void {
    const plugin = "plugin" in options ? options.plugin : options;
    const priority = "priority" in options ? (options.priority ?? 0) : 0;

    // Check for duplicate names
    if (this._plugins.some((p) => p.plugin.name === plugin.name)) {
      console.warn(`[Traffical] Plugin "${plugin.name}" already registered, skipping.`);
      return;
    }

    this._plugins.push({ plugin, priority });

    // Sort by priority (descending - higher priority first)
    this._plugins.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Unregister a plugin by name.
   */
  unregister(name: string): boolean {
    const index = this._plugins.findIndex((p) => p.plugin.name === name);
    if (index === -1) return false;

    this._plugins.splice(index, 1);
    return true;
  }

  /**
   * Get a registered plugin by name.
   */
  get(name: string): TrafficalPlugin | undefined {
    return this._plugins.find((p) => p.plugin.name === name)?.plugin;
  }

  /**
   * Get all registered plugins.
   */
  getAll(): TrafficalPlugin[] {
    return this._plugins.map((p) => p.plugin);
  }

  /**
   * Run onInitialize hooks.
   */
  async runInitialize(): Promise<void> {
    for (const { plugin } of this._plugins) {
      if (plugin.onInitialize) {
        try {
          await plugin.onInitialize();
        } catch (error) {
          console.warn(`[Traffical] Plugin "${plugin.name}" onInitialize error:`, error);
        }
      }
    }
  }

  /**
   * Run onConfigUpdate hooks.
   * Called when config bundle is fetched or refreshed.
   */
  runConfigUpdate(bundle: ConfigBundle): void {
    for (const { plugin } of this._plugins) {
      if (plugin.onConfigUpdate) {
        try {
          plugin.onConfigUpdate(bundle);
        } catch (error) {
          console.warn(`[Traffical] Plugin "${plugin.name}" onConfigUpdate error:`, error);
        }
      }
    }
  }

  /**
   * Run onBeforeDecision hooks.
   * Returns potentially modified context.
   */
  runBeforeDecision(context: Context): Context {
    let result = context;

    for (const { plugin } of this._plugins) {
      if (plugin.onBeforeDecision) {
        try {
          const modified = plugin.onBeforeDecision(result);
          if (modified) {
            result = modified;
          }
        } catch (error) {
          console.warn(`[Traffical] Plugin "${plugin.name}" onBeforeDecision error:`, error);
        }
      }
    }

    return result;
  }

  /**
   * Run onDecision hooks.
   */
  runDecision(decision: DecisionResult): void {
    for (const { plugin } of this._plugins) {
      if (plugin.onDecision) {
        try {
          plugin.onDecision(decision);
        } catch (error) {
          console.warn(`[Traffical] Plugin "${plugin.name}" onDecision error:`, error);
        }
      }
    }
  }

  /**
   * Run onResolve hooks.
   * Called after getParams() resolves parameters.
   */
  runResolve(params: Record<string, ParameterValue>): void {
    for (const { plugin } of this._plugins) {
      if (plugin.onResolve) {
        try {
          plugin.onResolve(params);
        } catch (error) {
          console.warn(`[Traffical] Plugin "${plugin.name}" onResolve error:`, error);
        }
      }
    }
  }

  /**
   * Run onExposure hooks.
   * Returns false if any plugin cancels the exposure.
   */
  runExposure(event: ExposureEvent): boolean {
    for (const { plugin } of this._plugins) {
      if (plugin.onExposure) {
        try {
          const result = plugin.onExposure(event);
          if (result === false) {
            return false;
          }
        } catch (error) {
          console.warn(`[Traffical] Plugin "${plugin.name}" onExposure error:`, error);
        }
      }
    }

    return true;
  }

  /**
   * Run onTrack hooks.
   * Returns false if any plugin cancels the track event.
   */
  runTrack(event: TrackEvent): boolean {
    for (const { plugin } of this._plugins) {
      if (plugin.onTrack) {
        try {
          const result = plugin.onTrack(event);
          if (result === false) {
            return false;
          }
        } catch (error) {
          console.warn(`[Traffical] Plugin "${plugin.name}" onTrack error:`, error);
        }
      }
    }

    return true;
  }

  /**
   * Run onDestroy hooks.
   */
  runDestroy(): void {
    for (const { plugin } of this._plugins) {
      if (plugin.onDestroy) {
        try {
          plugin.onDestroy();
        } catch (error) {
          console.warn(`[Traffical] Plugin "${plugin.name}" onDestroy error:`, error);
        }
      }
    }
  }

  /**
   * Clear all plugins.
   */
  clear(): void {
    this._plugins = [];
  }
}

// Re-export types
export type { TrafficalPlugin, PluginOptions } from "./types.js";

// Re-export plugins
export {
  createDecisionTrackingPlugin,
  type DecisionTrackingPluginOptions,
  type DecisionTrackingPluginDeps,
} from "./decision-tracking.js";

