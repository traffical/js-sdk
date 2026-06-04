/**
 * SHA-256 v2 Assignment Hash Tests
 *
 * Locks the canonical hash contract: UTF-8 byte-framed input, SHA-256 digest,
 * first 64 bits big-endian as the hash integer, and bucket = hashInt % bucketCount.
 */

import { describe, test, expect } from "bun:test";
import {
  assignmentInput,
  sha256Digest,
  hash64BE,
  hashInt64,
  utf8ByteLength,
} from "./assignment-hash.js";
import { computeBucket } from "./bucket.js";

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

describe("sha256Digest", () => {
  test("matches the canonical SHA-256 of 'abc'", () => {
    expect(toHex(sha256Digest("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  test("hashes UTF-8 bytes (not UTF-16 code units)", () => {
    // SHA-256 of the UTF-8 bytes of the empty string is the well-known
    // e3b0c442... digest.
    expect(toHex(sha256Digest(""))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });
});

describe("hash64BE / hashInt64", () => {
  test("reads the first 8 bytes as an unsigned big-endian 64-bit integer", () => {
    // First 8 bytes of SHA-256('abc') = 0xba7816bf8f01cfea.
    expect(hash64BE(sha256Digest("abc"))).toBe(13436514500253700074n);
    expect(hashInt64("abc")).toBe(13436514500253700074n);
  });
});

describe("assignmentInput", () => {
  test("produces the canonical length-framed, domain-separated string", () => {
    expect(assignmentInput("user-abc", "layer_ui")).toBe(
      "traffical:assignment:v2|u:8:user-abc|l:8:layer_ui"
    );
  });

  test("frames length in UTF-8 bytes, not UTF-16 code units", () => {
    // The rocket emoji is 4 UTF-8 bytes but 2 UTF-16 code units; "user-🚀-42"
    // is 12 UTF-8 bytes.
    expect(utf8ByteLength("user-🚀-42")).toBe(12);
    expect(assignmentInput("user-🚀-42", "layer_ui")).toBe(
      "traffical:assignment:v2|u:12:user-🚀-42|l:8:layer_ui"
    );
    // CJK: each of the 4 characters is 3 UTF-8 bytes = 12 bytes total.
    expect(utf8ByteLength("ユーザー")).toBe(12);
  });
});

describe("computeBucket", () => {
  test("produces consistent buckets for SHA-256 v2 vectors", () => {
    expect(computeBucket("user-abc", "layer_ui", 1000)).toBe(177);
    expect(computeBucket("user-abc", "layer_pricing", 1000)).toBe(902);
    expect(computeBucket("user-xyz", "layer_ui", 1000)).toBe(443);
    expect(computeBucket("user-xyz", "layer_pricing", 1000)).toBe(141);
    expect(computeBucket("user-123", "layer_ui", 1000)).toBe(480);
    expect(computeBucket("user-123", "layer_pricing", 1000)).toBe(738);
  });

  test("produces consistent buckets for non-ASCII unit keys", () => {
    expect(computeBucket("ユーザー", "layer_ui", 1000)).toBe(693);
    expect(computeBucket("user-🚀-42", "layer_ui", 1000)).toBe(771);
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

  test("different layers produce independent inputs (orthogonality)", () => {
    expect(hashInt64(assignmentInput("user-abc", "layer_1"))).not.toBe(
      hashInt64(assignmentInput("user-abc", "layer_2"))
    );
  });
});
