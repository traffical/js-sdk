/**
 * StableIdProvider - Anonymous user identification for experimentation.
 *
 * Generates a stable ID on first visit and persists it across sessions.
 * Uses localStorage as primary storage with cookie fallback.
 */

import type { StorageProvider } from "./storage.js";

const STORAGE_KEY = "stable_id";
const COOKIE_NAME = "traffical_sid";
const COOKIE_MAX_AGE_DAYS = 365;

export interface StableIdProviderOptions {
  /** Storage provider (localStorage) */
  storage: StorageProvider;
  /** Whether to use cookie fallback (default: true) */
  useCookieFallback?: boolean;
  /** Custom cookie name (default: traffical_sid) */
  cookieName?: string;
}

export class StableIdProvider {
  private _storage: StorageProvider;
  private _useCookieFallback: boolean;
  private _cookieName: string;
  private _cachedId: string | null = null;

  constructor(options: StableIdProviderOptions) {
    this._storage = options.storage;
    this._useCookieFallback = options.useCookieFallback ?? true;
    this._cookieName = options.cookieName ?? COOKIE_NAME;
  }

  /**
   * Get the stable ID, creating one if it doesn't exist.
   */
  getId(): string {
    // Check cache first
    if (this._cachedId) {
      return this._cachedId;
    }

    // Try localStorage
    let id = this._storage.get<string>(STORAGE_KEY);
    if (id) {
      this._cachedId = id;
      return id;
    }

    // Try cookie fallback
    if (this._useCookieFallback) {
      id = this._getCookie();
      if (id) {
        // Sync back to localStorage
        this._storage.set(STORAGE_KEY, id);
        this._cachedId = id;
        return id;
      }
    }

    // Generate new ID
    id = this._generateId();
    this._persist(id);
    this._cachedId = id;

    return id;
  }

  /**
   * Set a custom stable ID (e.g., when user logs in).
   */
  setId(id: string): void {
    this._persist(id);
    this._cachedId = id;
  }

  /**
   * Clear the stable ID (e.g., on logout).
   */
  clear(): void {
    this._storage.remove(STORAGE_KEY);
    if (this._useCookieFallback) {
      this._deleteCookie();
    }
    this._cachedId = null;
  }

  /**
   * Check if a stable ID exists.
   */
  hasId(): boolean {
    return this._storage.get<string>(STORAGE_KEY) !== null || this._getCookie() !== null;
  }

  private _persist(id: string): void {
    // Save to localStorage (no TTL - permanent)
    this._storage.set(STORAGE_KEY, id);

    // Save to cookie as fallback
    if (this._useCookieFallback) {
      this._setCookie(id);
    }
  }

  private _generateId(): string {
    // Use crypto.randomUUID if available (modern browsers)
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }

    // Fallback to manual UUID v4 generation
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  private _getCookie(): string | null {
    if (typeof document === "undefined") return null;

    try {
      const cookies = document.cookie.split(";");
      for (const cookie of cookies) {
        const [name, value] = cookie.trim().split("=");
        if (name === this._cookieName && value) {
          return decodeURIComponent(value);
        }
      }
    } catch {
      // Cookie access failed (e.g., cross-origin iframe)
    }

    return null;
  }

  private _setCookie(value: string): void {
    if (typeof document === "undefined") return;

    try {
      const maxAge = COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;
      document.cookie = `${this._cookieName}=${encodeURIComponent(value)}; max-age=${maxAge}; path=/; SameSite=Lax`;
    } catch {
      // Cookie access failed
    }
  }

  private _deleteCookie(): void {
    if (typeof document === "undefined") return;

    try {
      document.cookie = `${this._cookieName}=; max-age=0; path=/`;
    } catch {
      // Cookie access failed
    }
  }
}

