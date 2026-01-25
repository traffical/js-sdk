import { describe, test, expect, beforeEach } from "bun:test";
import { ExposureDeduplicator } from "./exposure-dedup";
import { MemoryStorageProvider } from "./storage";

describe("ExposureDeduplicator", () => {
  let storage: MemoryStorageProvider;
  let dedup: ExposureDeduplicator;

  beforeEach(() => {
    storage = new MemoryStorageProvider();
    dedup = new ExposureDeduplicator({ storage });
  });

  test("createKey generates correct format", () => {
    const key = ExposureDeduplicator.createKey("user_1", "policy_a", "control");
    expect(key).toBe("user_1:policy_a:control");
  });

  test("shouldTrack returns true for new exposure", () => {
    expect(dedup.shouldTrack("user_1:policy_a:control")).toBe(true);
  });

  test("shouldTrack returns false for duplicate", () => {
    dedup.shouldTrack("user_1:policy_a:control");
    expect(dedup.shouldTrack("user_1:policy_a:control")).toBe(false);
  });

  test("different variants are tracked separately", () => {
    expect(dedup.shouldTrack("user_1:policy_a:control")).toBe(true);
    expect(dedup.shouldTrack("user_1:policy_a:treatment")).toBe(true);
    expect(dedup.shouldTrack("user_1:policy_a:control")).toBe(false);
  });

  test("different users are tracked separately", () => {
    expect(dedup.shouldTrack("user_1:policy_a:control")).toBe(true);
    expect(dedup.shouldTrack("user_2:policy_a:control")).toBe(true);
  });

  test("checkAndMark combines key creation and tracking", () => {
    expect(dedup.checkAndMark("user_1", "policy_a", "control")).toBe(true);
    expect(dedup.checkAndMark("user_1", "policy_a", "control")).toBe(false);
    expect(dedup.checkAndMark("user_1", "policy_a", "treatment")).toBe(true);
  });

  test("size returns count of unique exposures", () => {
    expect(dedup.size).toBe(0);
    
    dedup.checkAndMark("user_1", "policy_a", "control");
    expect(dedup.size).toBe(1);
    
    dedup.checkAndMark("user_1", "policy_a", "control"); // duplicate
    expect(dedup.size).toBe(1);
    
    dedup.checkAndMark("user_2", "policy_a", "control");
    expect(dedup.size).toBe(2);
  });

  test("clear removes all tracked exposures", () => {
    dedup.checkAndMark("user_1", "policy_a", "control");
    expect(dedup.size).toBe(1);
    
    dedup.clear();
    expect(dedup.size).toBe(0);
    
    // Can track same exposure again after clear
    expect(dedup.checkAndMark("user_1", "policy_a", "control")).toBe(true);
  });

  test("persists to storage and restores", () => {
    dedup.checkAndMark("user_1", "policy_a", "control");
    
    // Create new instance with same storage
    const dedup2 = new ExposureDeduplicator({ storage });
    
    // Should recognize as duplicate from persisted state
    expect(dedup2.checkAndMark("user_1", "policy_a", "control")).toBe(false);
    expect(dedup2.size).toBe(1);
  });

  test("session expiry resets deduplication", async () => {
    const shortSessionDedup = new ExposureDeduplicator({
      storage,
      sessionTtlMs: 50, // 50ms session
    });

    shortSessionDedup.checkAndMark("user_1", "policy_a", "control");
    expect(shortSessionDedup.checkAndMark("user_1", "policy_a", "control")).toBe(false);

    await new Promise((r) => setTimeout(r, 60));

    // After session expiry, same exposure is tracked as new
    expect(shortSessionDedup.checkAndMark("user_1", "policy_a", "control")).toBe(true);
  });
});

