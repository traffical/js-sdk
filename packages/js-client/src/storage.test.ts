import { describe, test, expect, beforeEach } from "bun:test";
import { MemoryStorageProvider } from "./storage";

describe("MemoryStorageProvider", () => {
  let storage: MemoryStorageProvider;

  beforeEach(() => {
    storage = new MemoryStorageProvider();
  });

  test("get returns null for missing key", () => {
    expect(storage.get("missing")).toBeNull();
  });

  test("set and get work for primitives", () => {
    storage.set("string", "hello");
    storage.set("number", 42);
    storage.set("boolean", true);

    expect(storage.get("string")).toBe("hello");
    expect(storage.get("number")).toBe(42);
    expect(storage.get("boolean")).toBe(true);
  });

  test("set and get work for objects", () => {
    const obj = { foo: "bar", nested: { a: 1 } };
    storage.set("object", obj);
    expect(storage.get("object")).toEqual(obj);
  });

  test("remove deletes key", () => {
    storage.set("key", "value");
    expect(storage.get("key")).toBe("value");

    storage.remove("key");
    expect(storage.get("key")).toBeNull();
  });

  test("clear removes all keys", () => {
    storage.set("a", 1);
    storage.set("b", 2);
    
    storage.clear();
    
    expect(storage.get("a")).toBeNull();
    expect(storage.get("b")).toBeNull();
  });

  test("TTL expires entries", async () => {
    storage.set("expiring", "value", 50); // 50ms TTL
    
    expect(storage.get("expiring")).toBe("value");
    
    await new Promise((r) => setTimeout(r, 60));
    
    expect(storage.get("expiring")).toBeNull();
  });

  test("non-expiring entries persist", async () => {
    storage.set("persistent", "value"); // No TTL
    
    await new Promise((r) => setTimeout(r, 50));
    
    expect(storage.get("persistent")).toBe("value");
  });
});

