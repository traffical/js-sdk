import { describe, test, expect, beforeEach } from "bun:test";
import { StableIdProvider } from "./stable-id";
import { MemoryStorageProvider } from "./storage";

describe("StableIdProvider", () => {
  let storage: MemoryStorageProvider;
  let provider: StableIdProvider;

  beforeEach(() => {
    storage = new MemoryStorageProvider();
    provider = new StableIdProvider({ storage, useCookieFallback: false });
  });

  test("generates UUID on first call", () => {
    const id = provider.getId();
    
    // Should be a valid UUID format
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  test("returns same ID on subsequent calls", () => {
    const id1 = provider.getId();
    const id2 = provider.getId();
    const id3 = provider.getId();

    expect(id1).toBe(id2);
    expect(id2).toBe(id3);
  });

  test("persists ID to storage", () => {
    const id = provider.getId();
    
    // Create new provider with same storage
    const provider2 = new StableIdProvider({ storage, useCookieFallback: false });
    
    expect(provider2.getId()).toBe(id);
  });

  test("setId overrides generated ID", () => {
    provider.getId(); // Generate initial ID
    
    provider.setId("custom_user_123");
    
    expect(provider.getId()).toBe("custom_user_123");
  });

  test("setId persists to storage", () => {
    provider.setId("custom_user_123");
    
    const provider2 = new StableIdProvider({ storage, useCookieFallback: false });
    expect(provider2.getId()).toBe("custom_user_123");
  });

  test("clear removes ID", () => {
    const id1 = provider.getId();
    
    provider.clear();
    
    const id2 = provider.getId();
    expect(id2).not.toBe(id1);
  });

  test("hasId returns false before generation", () => {
    expect(provider.hasId()).toBe(false);
  });

  test("hasId returns true after generation", () => {
    provider.getId();
    expect(provider.hasId()).toBe(true);
  });

  test("hasId returns false after clear", () => {
    provider.getId();
    provider.clear();
    expect(provider.hasId()).toBe(false);
  });
});

