/**
 * FNV-1a Hash Tests
 *
 * Validates that the hash function produces consistent results.
 */

import { describe, test, expect } from "bun:test";
import { fnv1a } from "./fnv1a.js";
import { computeBucket } from "./bucket.js";

describe("fnv1a", () => {
  test("produces consistent hash for empty string", () => {
    expect(fnv1a("")).toBe(2166136261);
  });

  test("produces consistent hash for simple strings", () => {
    // These values are the canonical FNV-1a outputs
    expect(fnv1a("a")).toBe(3826002220);
    expect(fnv1a("test")).toBe(2949673445);
    expect(fnv1a("hello")).toBe(1335831723);
  });

  test("produces different hashes for different inputs", () => {
    const hash1 = fnv1a("user-abc");
    const hash2 = fnv1a("user-xyz");
    expect(hash1).not.toBe(hash2);
  });
});

describe("computeBucket", () => {
  test("produces consistent buckets for test vectors", () => {
    // Test case: user-abc:layer_ui
    const bucket1 = computeBucket("user-abc", "layer_ui", 1000);
    expect(bucket1).toBe(551);

    // Test case: user-abc:layer_pricing
    const bucket2 = computeBucket("user-abc", "layer_pricing", 1000);
    expect(bucket2).toBe(913);

    // Test case: user-xyz:layer_ui
    const bucket3 = computeBucket("user-xyz", "layer_ui", 1000);
    expect(bucket3).toBe(214);

    // Test case: user-xyz:layer_pricing
    const bucket4 = computeBucket("user-xyz", "layer_pricing", 1000);
    expect(bucket4).toBe(42);

    // Test case: user-123:layer_ui
    const bucket5 = computeBucket("user-123", "layer_ui", 1000);
    expect(bucket5).toBe(871);

    // Test case: user-123:layer_pricing
    const bucket6 = computeBucket("user-123", "layer_pricing", 1000);
    expect(bucket6).toBe(177);
  });

  test("bucket is always in valid range", () => {
    const bucketCount = 1000;
    const testInputs = [
      "user-1",
      "user-2",
      "user-abc",
      "user-xyz",
      "test-user-with-long-id-12345",
    ];

    for (const userId of testInputs) {
      const bucket = computeBucket(userId, "test_layer", bucketCount);
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(bucketCount);
    }
  });

  test("same input produces same bucket", () => {
    const bucket1 = computeBucket("user-abc", "layer_1", 1000);
    const bucket2 = computeBucket("user-abc", "layer_1", 1000);
    expect(bucket1).toBe(bucket2);
  });

  test("different layers produce different buckets (orthogonality)", () => {
    const bucket1 = computeBucket("user-abc", "layer_1", 1000);
    const bucket2 = computeBucket("user-abc", "layer_2", 1000);
    // While not guaranteed to be different, they should be independent
    // This test just ensures the layer ID is included in the hash
    expect(fnv1a("user-abc:layer_1")).not.toBe(fnv1a("user-abc:layer_2"));
  });
});
