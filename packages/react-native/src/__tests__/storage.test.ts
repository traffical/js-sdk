import { describe, it, expect, beforeEach, mock } from "bun:test";

// Mock AsyncStorage before importing storage module
const mockStore: Record<string, string> = {};
const mockAsyncStorage = {
  getAllKeys: mock(async () => Object.keys(mockStore)),
  multiGet: mock(async (keys: string[]) =>
    keys.map((k) => [k, mockStore[k] ?? null] as [string, string | null])
  ),
  setItem: mock(async (key: string, value: string) => {
    mockStore[key] = value;
  }),
  removeItem: mock(async (key: string) => {
    delete mockStore[key];
  }),
  multiRemove: mock(async (keys: string[]) => {
    for (const k of keys) delete mockStore[k];
  }),
};

mock.module("@react-native-async-storage/async-storage", () => ({
  default: mockAsyncStorage,
}));

const { createPreloadedAsyncStorage } = await import("../storage.js");

function clearMockStore() {
  for (const key of Object.keys(mockStore)) {
    delete mockStore[key];
  }
}

describe("createPreloadedAsyncStorage", () => {
  beforeEach(() => {
    clearMockStore();
    mockAsyncStorage.getAllKeys.mockClear();
    mockAsyncStorage.multiGet.mockClear();
    mockAsyncStorage.setItem.mockClear();
    mockAsyncStorage.removeItem.mockClear();
    mockAsyncStorage.multiRemove.mockClear();
  });

  it("should preload traffical-prefixed keys on waitUntilReady", async () => {
    mockStore["traffical:stable_id"] = JSON.stringify({ value: "abc-123" });
    mockStore["traffical:cache"] = JSON.stringify({ value: { foo: "bar" } });
    mockStore["other:key"] = JSON.stringify({ value: "ignored" });

    const storage = createPreloadedAsyncStorage();
    await storage.waitUntilReady();

    expect(mockAsyncStorage.getAllKeys).toHaveBeenCalledTimes(1);
    expect(mockAsyncStorage.multiGet).toHaveBeenCalledTimes(1);

    expect(storage.get("stable_id")).toBe("abc-123");
    expect(storage.get("cache")).toEqual({ foo: "bar" });
  });

  it("should return null for missing keys", async () => {
    const storage = createPreloadedAsyncStorage();
    await storage.waitUntilReady();

    expect(storage.get("nonexistent")).toBeNull();
  });

  it("should set values synchronously in memory and async to AsyncStorage", async () => {
    const storage = createPreloadedAsyncStorage();
    await storage.waitUntilReady();

    storage.set("mykey", "myvalue");

    // Synchronous read works immediately
    expect(storage.get("mykey")).toBe("myvalue");

    // Async write-through happened
    await new Promise((r) => setTimeout(r, 10));
    expect(mockAsyncStorage.setItem).toHaveBeenCalledTimes(1);
    expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
      "traffical:mykey",
      expect.any(String)
    );
  });

  it("should handle TTL expiry", async () => {
    const storage = createPreloadedAsyncStorage();
    await storage.waitUntilReady();

    storage.set("expiring", "value", 1);
    await new Promise((r) => setTimeout(r, 10));
    expect(storage.get("expiring")).toBeNull();
  });

  it("should remove values from memory and AsyncStorage", async () => {
    const storage = createPreloadedAsyncStorage();
    await storage.waitUntilReady();

    storage.set("removeMe", "value");
    expect(storage.get("removeMe")).toBe("value");

    storage.remove("removeMe");
    expect(storage.get("removeMe")).toBeNull();
    expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith(
      "traffical:removeMe"
    );
  });

  it("should clear all traffical keys", async () => {
    const storage = createPreloadedAsyncStorage();
    await storage.waitUntilReady();

    storage.set("a", 1);
    storage.set("b", 2);

    storage.clear();

    expect(storage.get("a")).toBeNull();
    expect(storage.get("b")).toBeNull();
    expect(mockAsyncStorage.multiRemove).toHaveBeenCalledTimes(1);
  });

  it("should only call prefetch once even if waitUntilReady is called multiple times", async () => {
    const storage = createPreloadedAsyncStorage();

    await Promise.all([
      storage.waitUntilReady(),
      storage.waitUntilReady(),
      storage.waitUntilReady(),
    ]);

    expect(mockAsyncStorage.getAllKeys).toHaveBeenCalledTimes(1);
  });

  it("should resolve immediately if already ready", async () => {
    const storage = createPreloadedAsyncStorage();
    await storage.waitUntilReady();

    // Second call should be instant
    const start = Date.now();
    await storage.waitUntilReady();
    expect(Date.now() - start).toBeLessThan(10);
  });

  it("should handle complex objects", async () => {
    const storage = createPreloadedAsyncStorage();
    await storage.waitUntilReady();

    const complex = {
      nested: { deep: true },
      array: [1, 2, 3],
      str: "hello",
    };
    storage.set("complex", complex);
    expect(storage.get("complex")).toEqual(complex);
  });
});
