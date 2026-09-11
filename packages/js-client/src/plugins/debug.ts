/**
 * Debug Plugin for Traffical JS Client SDK.
 *
 * Exposes SDK state via `window.__TRAFFICAL_DEBUG__` for consumption by
 * Traffical DevTools (or any external inspector). Supports multiple
 * simultaneous TrafficalClient instances.
 *
 * @example
 * ```typescript
 * import { createTrafficalClient, createDebugPlugin } from '@traffical/js-client';
 *
 * const client = await createTrafficalClient({
 *   orgId: 'org_123',
 *   projectId: 'proj_456',
 *   env: 'production',
 *   apiKey: 'pk_...',
 *   plugins: [createDebugPlugin()],
 * });
 * ```
 *
 * @example IIFE / script tag
 * ```html
 * <script>
 *   Traffical.init({
 *     ...config,
 *     plugins: [Traffical.createDebugPlugin({ instanceId: 'my-app' })],
 *   });
 * </script>
 * ```
 */

import type {
  ConfigBundle,
  Context,
  DecisionResult,
  ExposureEvent,
  TrackEvent,
  ParameterValue,
  LayerResolution,
} from "@traffical/core";
import type { TrafficalPlugin, PluginClientAPI } from "./types.js";
import { SDK_VERSION } from "../version.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DebugPluginOptions {
  /** Unique identifier for this instance. Auto-generated if omitted. */
  instanceId?: string;
  /** Maximum events to retain in the ring buffer (default: 500). */
  maxEvents?: number;
}

export interface DebugEvent {
  id: string;
  type: "decision" | "exposure" | "track";
  timestamp: number;
  data: unknown;
}

export interface DebugState {
  ready: boolean;
  stableId: string | null;
  /** The unit key actually used for hashing (from last decision metadata). */
  effectiveUnitKey: string | null;
  configVersion: string | null;
  assignments: Record<string, unknown>;
  layers: LayerResolution[];
  lastDecisionId: string | null;
  /** Parameter overrides currently applied by the debug plugin. */
  overrides: Record<string, unknown>;
  /**
   * Context attributes the debug plugin merges into every decision's context
   * (on top of whatever the host app passes). Lets an inspector satisfy
   * targeting conditions the app itself never sets, e.g. `testMode exists`.
   */
  contextOverrides: Record<string, unknown>;
  /**
   * The context of the last real decision, as the app passed it (after the
   * client's unit-key enrichment, before context overrides). `null` until the
   * app has decided at least once.
   */
  lastContext: Record<string, unknown> | null;
}

export interface TrafficalDebugInstance {
  readonly id: string;
  readonly meta: {
    orgId: string;
    projectId: string;
    env: string;
    sdkVersion: string;
  };
  getState(): DebugState;
  subscribe(cb: (state: DebugState) => void): () => void;
  getEvents(limit?: number): DebugEvent[];
  onEvent(cb: (event: DebugEvent) => void): () => void;
  getConfigBundle(): ConfigBundle | null;
  setUnitKey(key: string): void;
  setOverride(key: string, value: unknown): void;
  clearOverride(key: string): void;
  clearAllOverrides(): void;
  getOverrides(): Record<string, unknown>;
  /**
   * Replace the context attributes merged into every decision. Re-decides
   * immediately. Pass `{}` to clear.
   */
  setContextOverrides(context: Record<string, unknown>): void;
  getContextOverrides(): Record<string, unknown>;
  /**
   * Re-run the app's last decision (same context and parameter set) so the
   * inspector shows what the app would resolve right now. If the page uses
   * the OpenFeature provider, the OpenFeature context is re-set so hooks
   * bound to `PROVIDER_CONTEXT_CHANGED` re-render too.
   */
  reDecide(): void;
  refresh(): Promise<void>;
}

export type RegistryEventType = "register" | "unregister";

export interface RegistryEvent {
  type: RegistryEventType;
  instanceId: string;
}

export interface TrafficalDebugRegistry {
  readonly version: 1;
  readonly instances: Record<string, TrafficalDebugInstance>;
  subscribe(cb: (event: RegistryEvent) => void): () => void;
}

// ---------------------------------------------------------------------------
// Global window augmentation
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    __TRAFFICAL_DEBUG__?: TrafficalDebugRegistry;
    __TRAFFICAL_INSTANCES__?: unknown[];
  }
}

// ---------------------------------------------------------------------------
// Registry (singleton per window)
// ---------------------------------------------------------------------------

let _registryListeners: Array<(event: RegistryEvent) => void> = [];
let _registryInstances: Record<string, TrafficalDebugInstance> = {};

function getOrCreateRegistry(): TrafficalDebugRegistry {
  if (typeof window === "undefined") {
    return { version: 1, instances: _registryInstances, subscribe: () => () => {} };
  }

  if (!window.__TRAFFICAL_DEBUG__) {
    const registry: TrafficalDebugRegistry = {
      version: 1,
      instances: _registryInstances,
      subscribe(cb: (event: RegistryEvent) => void): () => void {
        _registryListeners.push(cb);
        return () => {
          _registryListeners = _registryListeners.filter((l) => l !== cb);
        };
      },
    };
    window.__TRAFFICAL_DEBUG__ = registry;
  }

  return window.__TRAFFICAL_DEBUG__!;
}

function emitRegistryEvent(event: RegistryEvent): void {
  for (const listener of _registryListeners) {
    try {
      listener(event);
    } catch {
      // Ignore listener errors
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _idCounter = 0;

/**
 * The OpenFeature web SDK stores its API singleton on globalThis under a
 * well-known symbol. Nudging its context makes `@traffical/openfeature-web`
 * re-resolve every flag (through this client's `decide`, and therefore
 * through the debug plugin's `onBeforeDecision`) and emit
 * `PROVIDER_CONTEXT_CHANGED`, which is what host-app hooks re-render on.
 */
const OPENFEATURE_API_SYMBOL = Symbol.for("@openfeature/web-sdk/api");

interface OpenFeatureApiLike {
  getContext(domain?: string): Record<string, unknown>;
  setContext(context: Record<string, unknown>): Promise<void>;
}

function getOpenFeatureApi(): OpenFeatureApiLike | null {
  const api = (globalThis as Record<symbol, unknown>)[OPENFEATURE_API_SYMBOL] as
    | Partial<OpenFeatureApiLike>
    | undefined;
  if (api && typeof api.getContext === "function" && typeof api.setContext === "function") {
    return api as OpenFeatureApiLike;
  }
  return null;
}

function generateId(): string {
  return `traffical_${Date.now().toString(36)}_${(++_idCounter).toString(36)}`;
}

function generateEventId(): string {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

const PLUGIN_NAME = "traffical-debug";

export function createDebugPlugin(
  options: DebugPluginOptions = {},
): TrafficalPlugin {
  const instanceId = options.instanceId ?? generateId();
  const maxEvents = options.maxEvents ?? 500;

  // Internal state
  let _client: PluginClientAPI | null = null;
  let _bundle: ConfigBundle | null = null;
  let _assignments: Record<string, unknown> = {};
  let _layers: LayerResolution[] = [];
  let _lastDecisionId: string | null = null;
  let _effectiveUnitKey: string | null = null;
  let _contextOverrides: Record<string, unknown> = {};
  let _lastContext: Context | null = null;
  let _lastDefaults: Record<string, ParameterValue> | null = null;
  const _events: DebugEvent[] = [];
  let _stateListeners: Array<(state: DebugState) => void> = [];
  let _eventListeners: Array<(event: DebugEvent) => void> = [];

  function buildState(): DebugState {
    return {
      ready: _client?.isInitialized === true,
      stableId: _client?.getStableId?.() ?? null,
      effectiveUnitKey: _effectiveUnitKey,
      configVersion: _client?.getConfigVersion?.() ?? null,
      assignments: { ..._assignments },
      layers: [..._layers],
      lastDecisionId: _lastDecisionId,
      overrides: _client?.getOverrides?.() ?? {},
      contextOverrides: { ..._contextOverrides },
      lastContext: _lastContext ? { ..._lastContext } : null,
    };
  }

  function notifyStateListeners(): void {
    const state = buildState();
    for (const cb of _stateListeners) {
      try {
        cb(state);
      } catch {
        // Ignore
      }
    }
  }

  function pushEvent(type: DebugEvent["type"], data: unknown): void {
    const event: DebugEvent = {
      id: generateEventId(),
      type,
      timestamp: Date.now(),
      data,
    };
    _events.push(event);
    if (_events.length > maxEvents) {
      _events.splice(0, _events.length - maxEvents);
    }
    for (const cb of _eventListeners) {
      try {
        cb(event);
      } catch {
        // Ignore
      }
    }
  }

  function triggerReDecide(): void {
    if (!_client) return;

    // Replay the app's last real decision. Unknown parameter keys keep the
    // values we pass; known ones are re-resolved from the bundle, so the
    // previous assignments are a faithful stand-in for the app's defaults.
    // Before the app has decided once there is nothing to replay: an empty
    // decision still refreshes layer/bucket info without resolving params.
    try {
      _client.decide({
        context: _lastContext ? { ..._lastContext } : {},
        defaults: _lastDefaults ? { ..._lastDefaults } : {},
      });
    } catch {
      // Best-effort
    }

    // OpenFeature-hosted apps resolve through the provider's bound context,
    // not through the decision above. Re-setting the same context forces the
    // provider to clear its memo and re-resolve, and fires
    // PROVIDER_CONTEXT_CHANGED so the app's hooks pick up the new values.
    const openFeature = getOpenFeatureApi();
    if (openFeature) {
      try {
        void openFeature.setContext({ ...openFeature.getContext() }).catch(() => {});
      } catch {
        // Best-effort
      }
    }
  }

  // Build the instance that gets registered in the global registry
  const debugInstance: TrafficalDebugInstance = {
    id: instanceId,
    meta: {
      orgId: "",
      projectId: "",
      env: "",
      sdkVersion: SDK_VERSION,
    },

    getState: buildState,

    subscribe(cb: (state: DebugState) => void): () => void {
      _stateListeners.push(cb);
      return () => {
        _stateListeners = _stateListeners.filter((l) => l !== cb);
      };
    },

    getEvents(limit?: number): DebugEvent[] {
      if (limit !== undefined) {
        return _events.slice(-limit);
      }
      return [..._events];
    },

    onEvent(cb: (event: DebugEvent) => void): () => void {
      _eventListeners.push(cb);
      return () => {
        _eventListeners = _eventListeners.filter((l) => l !== cb);
      };
    },

    getConfigBundle(): ConfigBundle | null {
      return _bundle;
    },

    setUnitKey(key: string): void {
      if (_client?.identify) {
        _client.identify(key);
      } else if (_client?.setStableId) {
        _client.setStableId(key);
      }
      notifyStateListeners();
    },

    setOverride(key: string, value: unknown): void {
      if (_client?.applyOverrides) {
        _client.applyOverrides({ [key]: value as ParameterValue });
      }
      notifyStateListeners();
      triggerReDecide();
    },

    clearOverride(key: string): void {
      if (_client?.getOverrides && _client?.applyOverrides) {
        const current = _client.getOverrides();
        delete current[key];
        _client.clearOverrides?.();
        _client.applyOverrides(current);
      }
      notifyStateListeners();
      triggerReDecide();
    },

    clearAllOverrides(): void {
      _client?.clearOverrides?.();
      notifyStateListeners();
      triggerReDecide();
    },

    getOverrides(): Record<string, unknown> {
      return _client?.getOverrides?.() ?? {};
    },

    setContextOverrides(context: Record<string, unknown>): void {
      _contextOverrides = { ...context };
      notifyStateListeners();
      triggerReDecide();
    },

    getContextOverrides(): Record<string, unknown> {
      return { ..._contextOverrides };
    },

    reDecide(): void {
      triggerReDecide();
    },

    async refresh(): Promise<void> {
      if (_client?.refreshConfig) {
        await _client.refreshConfig();
      }
    },
  };

  // The actual plugin
  const plugin: TrafficalPlugin = {
    name: PLUGIN_NAME,

    onInitialize(client: PluginClientAPI): void {
      _client = client;

      // Extract meta from the config bundle if available
      if (_bundle) {
        (debugInstance.meta as { orgId: string }).orgId = _bundle.orgId;
        (debugInstance.meta as { projectId: string }).projectId = _bundle.projectId;
        (debugInstance.meta as { env: string }).env = _bundle.env;
      }

      // Register in the global registry
      const registry = getOrCreateRegistry();
      (registry.instances as Record<string, TrafficalDebugInstance>)[instanceId] = debugInstance;
      emitRegistryEvent({ type: "register", instanceId });
      notifyStateListeners();
    },

    onConfigUpdate(bundle: ConfigBundle): void {
      _bundle = bundle;

      // Update meta from bundle
      (debugInstance.meta as { orgId: string }).orgId = bundle.orgId;
      (debugInstance.meta as { projectId: string }).projectId = bundle.projectId;
      (debugInstance.meta as { env: string }).env = bundle.env;

      notifyStateListeners();
    },

    onBeforeDecision(context: Context): Context | void {
      _lastContext = { ...context };
      if (Object.keys(_contextOverrides).length === 0) return;
      return { ...context, ..._contextOverrides } as Context;
    },

    onDecision(decision: DecisionResult): void {
      _lastDefaults = { ...decision.assignments };
      _assignments = { ...decision.assignments };
      _layers = decision.metadata?.layers ? [...decision.metadata.layers] : [];
      _lastDecisionId = decision.decisionId;
      if (decision.metadata?.unitKeyValue) {
        _effectiveUnitKey = decision.metadata.unitKeyValue;
      }
      pushEvent("decision", decision);
      notifyStateListeners();
    },

    onResolve(params: Record<string, ParameterValue>): void {
      _assignments = { ...params };
      notifyStateListeners();
    },

    onExposure(event: ExposureEvent): boolean | void {
      pushEvent("exposure", event);
      return true;
    },

    onTrack(event: TrackEvent): boolean | void {
      pushEvent("track", event);
      return true;
    },

    onDestroy(): void {
      // Unregister from registry
      const registry =
        typeof window !== "undefined" ? window.__TRAFFICAL_DEBUG__ : null;
      if (registry) {
        delete (registry.instances as Record<string, TrafficalDebugInstance>)[
          instanceId
        ];
        emitRegistryEvent({ type: "unregister", instanceId });
      }
      _stateListeners = [];
      _eventListeners = [];
      _contextOverrides = {};
      _lastContext = null;
      _lastDefaults = null;
      _client = null;
    },
  };

  return plugin;
}
