/**
 * Storage abstraction for browser environments.
 *
 * Provides a safe wrapper around localStorage with:
 * - Automatic JSON serialization/deserialization
 * - Graceful fallback when localStorage is unavailable
 * - TTL support for expiring entries
 */

export interface StorageProvider {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T, ttlMs?: number): void;
  remove(key: string): void;
  clear(): void;
}

interface StoredValue<T> {
  value: T;
  expiresAt?: number;
}

const STORAGE_PREFIX = "traffical:";

/**
 * localStorage-based storage provider.
 */
export class LocalStorageProvider implements StorageProvider {
  private _available: boolean;

  constructor() {
    this._available = this._checkAvailability();
  }

  get<T>(key: string): T | null {
    if (!this._available) return null;

    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + key);
      if (!raw) return null;

      const stored = JSON.parse(raw) as StoredValue<T>;

      // Check TTL
      if (stored.expiresAt && Date.now() > stored.expiresAt) {
        this.remove(key);
        return null;
      }

      return stored.value;
    } catch {
      return null;
    }
  }

  set<T>(key: string, value: T, ttlMs?: number): void {
    if (!this._available) return;

    try {
      const stored: StoredValue<T> = {
        value,
        ...(ttlMs && { expiresAt: Date.now() + ttlMs }),
      };
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(stored));
    } catch {
      // Storage full or unavailable - silently fail
    }
  }

  remove(key: string): void {
    if (!this._available) return;

    try {
      localStorage.removeItem(STORAGE_PREFIX + key);
    } catch {
      // Silently fail
    }
  }

  clear(): void {
    if (!this._available) return;

    try {
      // Only clear traffical-prefixed keys
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(STORAGE_PREFIX)) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key));
    } catch {
      // Silently fail
    }
  }

  private _checkAvailability(): boolean {
    try {
      const testKey = STORAGE_PREFIX + "__test__";
      localStorage.setItem(testKey, "test");
      localStorage.removeItem(testKey);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * In-memory storage fallback when localStorage is unavailable.
 */
export class MemoryStorageProvider implements StorageProvider {
  private _store = new Map<string, StoredValue<unknown>>();

  get<T>(key: string): T | null {
    const stored = this._store.get(key) as StoredValue<T> | undefined;
    if (!stored) return null;

    // Check TTL
    if (stored.expiresAt && Date.now() > stored.expiresAt) {
      this.remove(key);
      return null;
    }

    return stored.value;
  }

  set<T>(key: string, value: T, ttlMs?: number): void {
    this._store.set(key, {
      value,
      ...(ttlMs && { expiresAt: Date.now() + ttlMs }),
    });
  }

  remove(key: string): void {
    this._store.delete(key);
  }

  clear(): void {
    this._store.clear();
  }
}

/**
 * Creates the appropriate storage provider for the current environment.
 */
export function createStorageProvider(): StorageProvider {
  // Try localStorage first
  const localProvider = new LocalStorageProvider();
  if (localProvider.get("__check__") !== null || localStorageAvailable()) {
    return localProvider;
  }
  // Fall back to in-memory
  return new MemoryStorageProvider();
}

function localStorageAvailable(): boolean {
  try {
    const testKey = "__traffical_storage_test__";
    localStorage.setItem(testKey, "test");
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

