import AsyncStorage from "@react-native-async-storage/async-storage";
import type { StorageProvider } from "@traffical/js-client";

const STORAGE_PREFIX = "traffical:";

interface StoredValue<T> {
  value: T;
  expiresAt?: number;
}

export interface PreloadedAsyncStorageProvider extends StorageProvider {
  waitUntilReady(): Promise<void>;
}

export function createPreloadedAsyncStorage(): PreloadedAsyncStorageProvider {
  const inMemoryStore: Record<string, string> = {};
  let isReady = false;
  let readyPromise: Promise<void> | null = null;

  function waitUntilReady(): Promise<void> {
    if (isReady) return Promise.resolve();
    if (!readyPromise) {
      readyPromise = prefetch().then(() => {
        isReady = true;
      });
    }
    return readyPromise;
  }

  async function prefetch(): Promise<void> {
    const keys = await AsyncStorage.getAllKeys();
    const trafficalKeys = keys.filter((k) => k.startsWith(STORAGE_PREFIX));
    if (trafficalKeys.length === 0) return;
    const entries = await AsyncStorage.multiGet(trafficalKeys);
    for (const [key, value] of entries) {
      if (value != null) inMemoryStore[key] = value;
    }
  }

  const provider: PreloadedAsyncStorageProvider = {
    waitUntilReady,

    get<T>(key: string): T | null {
      const raw = inMemoryStore[STORAGE_PREFIX + key];
      if (!raw) return null;
      try {
        const stored = JSON.parse(raw) as StoredValue<T>;
        if (stored.expiresAt && Date.now() > stored.expiresAt) {
          provider.remove(key);
          return null;
        }
        return stored.value;
      } catch {
        return null;
      }
    },

    set<T>(key: string, value: T, ttlMs?: number): void {
      const stored: StoredValue<T> = {
        value,
        ...(ttlMs && { expiresAt: Date.now() + ttlMs }),
      };
      const serialized = JSON.stringify(stored);
      inMemoryStore[STORAGE_PREFIX + key] = serialized;
      AsyncStorage.setItem(STORAGE_PREFIX + key, serialized).catch(() => {});
    },

    remove(key: string): void {
      delete inMemoryStore[STORAGE_PREFIX + key];
      AsyncStorage.removeItem(STORAGE_PREFIX + key).catch(() => {});
    },

    clear(): void {
      const keys = Object.keys(inMemoryStore).filter((k) =>
        k.startsWith(STORAGE_PREFIX)
      );
      for (const k of keys) {
        delete inMemoryStore[k];
      }
      AsyncStorage.multiRemove(keys).catch(() => {});
    },
  };

  return provider;
}
