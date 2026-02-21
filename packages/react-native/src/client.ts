import {
  TrafficalClient,
  type TrafficalClientOptions,
  type LifecycleProvider,
} from "@traffical/js-client";
import type { ServerResolveResponse } from "@traffical/core";
import {
  createPreloadedAsyncStorage,
  type PreloadedAsyncStorageProvider,
} from "./storage.js";
import { createRNLifecycleProvider } from "./lifecycle.js";
import type { DeviceInfoProvider } from "./device-info.js";

export interface TrafficalRNClientOptions extends TrafficalClientOptions {
  deviceInfoProvider?: DeviceInfoProvider;
  /** Cache max age in ms for persisted server responses (default: 86400000 = 24 hours) */
  cacheMaxAgeMs?: number;
}

const CACHED_RESPONSE_KEY = "server_resolve_cache";
const CACHED_RESPONSE_TIMESTAMP_KEY = "server_resolve_cache_ts";
const DEFAULT_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_SUGGESTED_REFRESH_MS = 60_000; // 60 seconds

export class TrafficalRNClient extends TrafficalClient {
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
   * 2. Load cached server response if available
   * 3. Call parent initialize (fetches from server)
   * 4. Persist response to cache
   */
  async initialize(): Promise<void> {
    await this._rnStorage.waitUntilReady();

    const cached = this._loadCachedResponse();
    if (cached) {
      this._lastResolveTimestamp = this._loadCachedTimestamp();
      if (cached.suggestedRefreshMs) {
        this._suggestedRefreshMs = cached.suggestedRefreshMs;
      }
    }

    await super.initialize();

    this._persistCurrentResponse();
  }

  override destroy(): void {
    if (this._visibilityCallback) {
      this._rnLifecycle.removeVisibilityListener(this._visibilityCallback);
      this._visibilityCallback = null;
    }
    super.destroy();
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
    const version = this.getConfigVersion();
    if (!version) return;

    const now = Date.now();
    this._lastResolveTimestamp = now;
    this._rnStorage.set(CACHED_RESPONSE_TIMESTAMP_KEY, now, this._cacheMaxAgeMs);
  }
}
