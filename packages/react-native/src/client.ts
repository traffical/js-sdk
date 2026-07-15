import {
  TrafficalClient,
  type TrafficalClientOptions,
  type LifecycleProvider,
} from "@traffical/js-client";
import type { ServerResolveResponse, TrackEventMap } from "@traffical/core";
import {
  createPreloadedAsyncStorage,
  type PreloadedAsyncStorageProvider,
} from "./storage.js";
import { createRNLifecycleProvider } from "./lifecycle.js";
import type { DeviceInfoProvider } from "./device-info.js";

/**
 * Minimal view of the base client's private `_state` we need for offline
 * server-response caching. The base `TrafficalClient` seeds `_state.bundle`
 * from `localConfig` but has no equivalent seed for server-mode responses, so
 * the RN subclass injects a persisted response directly. This is confined to
 * the RN package and is the narrowest possible reach into the base state.
 */
interface ClientStateView {
  serverResponse: ServerResolveResponse | null;
}

export interface TrafficalRNClientOptions extends TrafficalClientOptions {
  deviceInfoProvider?: DeviceInfoProvider;
  /** Cache max age in ms for persisted server responses (default: 86400000 = 24 hours) */
  cacheMaxAgeMs?: number;
}

const CACHED_RESPONSE_KEY = "server_resolve_cache";
const CACHED_RESPONSE_TIMESTAMP_KEY = "server_resolve_cache_ts";
const DEFAULT_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_SUGGESTED_REFRESH_MS = 60_000; // 60 seconds

export class TrafficalRNClient<TEvents extends TrackEventMap = TrackEventMap> extends TrafficalClient<TEvents> {
  private readonly _rnStorage: PreloadedAsyncStorageProvider;
  private readonly _rnLifecycle: LifecycleProvider;
  readonly deviceInfoProvider?: DeviceInfoProvider;
  private readonly _cacheMaxAgeMs: number;
  private _lastResolveTimestamp = 0;
  private _suggestedRefreshMs = DEFAULT_SUGGESTED_REFRESH_MS;
  private _visibilityCallback: ((state: "foreground" | "background") => void) | null =
    null;

  constructor(options: TrafficalRNClientOptions) {
    const rnStorage =
      (options.storage as PreloadedAsyncStorageProvider | undefined) ??
      createPreloadedAsyncStorage();
    const lifecycle = options.lifecycleProvider ?? createRNLifecycleProvider();

    super({
      ...options,
      evaluationMode: options.evaluationMode ?? "server",
      storage: rnStorage,
      lifecycleProvider: lifecycle,
    });

    this._rnStorage = rnStorage;
    this._rnLifecycle = lifecycle;
    this.deviceInfoProvider = options.deviceInfoProvider;
    this._cacheMaxAgeMs = options.cacheMaxAgeMs ?? DEFAULT_CACHE_MAX_AGE_MS;

    this._setupForegroundRefresh();
  }

  /**
   * RN-specific initialization:
   * 1. Wait for AsyncStorage preload
   * 2. Load cached server response and INJECT it into client state so an
   *    offline cold start serves the last-known assignments immediately
   * 3. Call parent initialize (fetches from server; on failure the injected
   *    cached response survives — the base resolve fetch only overwrites
   *    serverResponse on success)
   * 4. Persist the (possibly refreshed) response to cache
   */
  async initialize(): Promise<void> {
    await this._rnStorage.waitUntilReady();

    const cached = this._loadCachedResponse();
    if (cached) {
      // Seed the base client's state BEFORE super.initialize() so getParams /
      // decide resolve against the cached response even if the network is down.
      this._baseState().serverResponse = cached;
      this._lastResolveTimestamp = this._loadCachedTimestamp();
      if (cached.suggestedRefreshMs) {
        this._suggestedRefreshMs = cached.suggestedRefreshMs;
      }
    }

    await super.initialize();

    this._persistCurrentResponse();
  }

  override destroy(): void {
    this._teardownRNLifecycle();
    super.destroy();
  }

  override async close(): Promise<void> {
    this._teardownRNLifecycle();
    await super.close();
  }

  /** Remove our foreground listener AND the native AppState subscription. */
  private _teardownRNLifecycle(): void {
    if (this._visibilityCallback) {
      this._rnLifecycle.removeVisibilityListener(this._visibilityCallback);
      this._visibilityCallback = null;
    }
    const disposable = this._rnLifecycle as LifecycleProvider & {
      dispose?: () => void;
    };
    disposable.dispose?.();
  }

  /** Narrow, RN-only reach into the base client's private state (see above). */
  private _baseState(): ClientStateView {
    return (this as unknown as { _state: ClientStateView })._state;
  }

  override async refreshConfig(): Promise<void> {
    await super.refreshConfig();
    this._lastResolveTimestamp = Date.now();
    this._persistCurrentResponse();
  }

  private _setupForegroundRefresh(): void {
    this._visibilityCallback = (state) => {
      if (state === "foreground") {
        const elapsed = Date.now() - this._lastResolveTimestamp;
        if (elapsed >= this._suggestedRefreshMs) {
          this.refreshConfig().catch(() => {});
        }
      }
    };
    this._rnLifecycle.onVisibilityChange(this._visibilityCallback);
  }

  private _loadCachedResponse(): ServerResolveResponse | null {
    return this._rnStorage.get<ServerResolveResponse>(CACHED_RESPONSE_KEY);
  }

  private _loadCachedTimestamp(): number {
    return this._rnStorage.get<number>(CACHED_RESPONSE_TIMESTAMP_KEY) ?? 0;
  }

  private _persistCurrentResponse(): void {
    const response = this._baseState().serverResponse;
    if (!response) return;

    const now = Date.now();
    this._lastResolveTimestamp = now;
    // Persist the FULL resolve response (not just a timestamp) so the next cold
    // start can serve it offline. Keyed by CACHED_RESPONSE_KEY, which
    // _loadCachedResponse reads back.
    this._rnStorage.set(CACHED_RESPONSE_KEY, response, this._cacheMaxAgeMs);
    this._rnStorage.set(CACHED_RESPONSE_TIMESTAMP_KEY, now, this._cacheMaxAgeMs);
  }
}
