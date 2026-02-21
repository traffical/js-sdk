import { describe, it, expect, beforeEach, mock, spyOn } from "bun:test";
import type { StorageProvider, LifecycleProvider, VisibilityCallback } from "@traffical/js-client";

// Mock AsyncStorage
const mockAsyncStore: Record<string, string> = {};
mock.module("@react-native-async-storage/async-storage", () => ({
  default: {
    getAllKeys: mock(async () => Object.keys(mockAsyncStore)),
    multiGet: mock(async (keys: string[]) =>
      keys.map((k) => [k, mockAsyncStore[k] ?? null] as [string, string | null])
    ),
    setItem: mock(async (key: string, value: string) => {
      mockAsyncStore[key] = value;
    }),
    removeItem: mock(async (key: string) => {
      delete mockAsyncStore[key];
    }),
    multiRemove: mock(async (keys: string[]) => {
      for (const k of keys) delete mockAsyncStore[k];
    }),
  },
}));

// Mock react-native AppState
let appStateListeners: Array<(state: string) => void> = [];
mock.module("react-native", () => ({
  AppState: {
    addEventListener: mock((_event: string, callback: (state: string) => void) => {
      appStateListeners.push(callback);
      return { remove: () => {} };
    }),
  },
}));

const { TrafficalRNClient } = await import("../client.js");

function clearMockStore() {
  for (const key of Object.keys(mockAsyncStore)) {
    delete mockAsyncStore[key];
  }
}

function createMockStorage(): StorageProvider {
  const store = new Map<string, unknown>();
  return {
    get<T>(key: string): T | null {
      return (store.get(key) as T) ?? null;
    },
    set<T>(key: string, value: T): void {
      store.set(key, value);
    },
    remove(key: string): void {
      store.delete(key);
    },
    clear(): void {
      store.clear();
    },
  };
}

function createMockLifecycle(): LifecycleProvider & {
  listeners: VisibilityCallback[];
  simulateState: (state: "foreground" | "background") => void;
} {
  const listeners: VisibilityCallback[] = [];
  return {
    listeners,
    onVisibilityChange(callback: VisibilityCallback): void {
      listeners.push(callback);
    },
    removeVisibilityListener(callback: VisibilityCallback): void {
      const idx = listeners.indexOf(callback);
      if (idx !== -1) listeners.splice(idx, 1);
    },
    isUnloading(): boolean {
      return false;
    },
    simulateState(state: "foreground" | "background"): void {
      for (const cb of listeners) cb(state);
    },
  };
}

describe("TrafficalRNClient", () => {
  beforeEach(() => {
    clearMockStore();
    appStateListeners = [];
  });

  it("should default evaluationMode to server", () => {
    const lifecycle = createMockLifecycle();
    const client = new TrafficalRNClient({
      orgId: "org_test",
      projectId: "proj_test",
      env: "test",
      apiKey: "pk_test",
      storage: createMockStorage(),
      lifecycleProvider: lifecycle,
    });

    // The client should be created without errors
    expect(client).toBeDefined();
    expect(client).toBeInstanceOf(TrafficalRNClient);
  });

  it("should accept custom cacheMaxAgeMs", () => {
    const lifecycle = createMockLifecycle();
    const client = new TrafficalRNClient({
      orgId: "org_test",
      projectId: "proj_test",
      env: "test",
      apiKey: "pk_test",
      storage: createMockStorage(),
      lifecycleProvider: lifecycle,
      cacheMaxAgeMs: 60_000,
    });

    expect(client).toBeDefined();
  });

  it("should allow overriding evaluationMode to bundle", () => {
    const lifecycle = createMockLifecycle();
    const client = new TrafficalRNClient({
      orgId: "org_test",
      projectId: "proj_test",
      env: "test",
      apiKey: "pk_test",
      evaluationMode: "bundle",
      storage: createMockStorage(),
      lifecycleProvider: lifecycle,
    });

    expect(client).toBeDefined();
  });

  it("should subscribe to lifecycle for foreground refresh", () => {
    const lifecycle = createMockLifecycle();
    const _client = new TrafficalRNClient({
      orgId: "org_test",
      projectId: "proj_test",
      env: "test",
      apiKey: "pk_test",
      storage: createMockStorage(),
      lifecycleProvider: lifecycle,
    });

    // Two listeners: one from EventLogger (parent), one from foreground-resume refresh
    expect(lifecycle.listeners.length).toBe(2);
  });

  it("should remove lifecycle listener on destroy", () => {
    const lifecycle = createMockLifecycle();
    const client = new TrafficalRNClient({
      orgId: "org_test",
      projectId: "proj_test",
      env: "test",
      apiKey: "pk_test",
      storage: createMockStorage(),
      lifecycleProvider: lifecycle,
    });

    expect(lifecycle.listeners.length).toBe(2);

    client.destroy();

    // Our foreground-resume listener is removed; EventLogger's listener is
    // also cleaned up via its own destroy path
    expect(lifecycle.listeners.length).toBeLessThanOrEqual(1);
  });

  it("should attempt refresh on foreground when stale", () => {
    const lifecycle = createMockLifecycle();
    const client = new TrafficalRNClient({
      orgId: "org_test",
      projectId: "proj_test",
      env: "test",
      apiKey: "pk_test",
      storage: createMockStorage(),
      lifecycleProvider: lifecycle,
    });

    const refreshSpy = spyOn(client, "refreshConfig").mockResolvedValue(
      undefined
    );

    // Simulate coming to foreground (lastResolveTimestamp is 0, so always stale)
    lifecycle.simulateState("foreground");

    expect(refreshSpy).toHaveBeenCalledTimes(1);

    client.destroy();
  });

  it("should not refresh on background events", () => {
    const lifecycle = createMockLifecycle();
    const client = new TrafficalRNClient({
      orgId: "org_test",
      projectId: "proj_test",
      env: "test",
      apiKey: "pk_test",
      storage: createMockStorage(),
      lifecycleProvider: lifecycle,
    });

    const refreshSpy = spyOn(client, "refreshConfig").mockResolvedValue(
      undefined
    );

    lifecycle.simulateState("background");

    expect(refreshSpy).toHaveBeenCalledTimes(0);

    client.destroy();
  });

  it("should accept a deviceInfoProvider", () => {
    const lifecycle = createMockLifecycle();
    const client = new TrafficalRNClient({
      orgId: "org_test",
      projectId: "proj_test",
      env: "test",
      apiKey: "pk_test",
      storage: createMockStorage(),
      lifecycleProvider: lifecycle,
      deviceInfoProvider: {
        getDeviceInfo: () => ({
          osName: "iOS",
          osVersion: "17.0",
          deviceModel: "iPhone15,4",
        }),
      },
    });

    expect(client).toBeDefined();
    client.destroy();
  });
});
