/**
 * SHA-256 Assignment Hash (contract v2)
 *
 * The canonical deterministic hash for Traffical bucket assignment and
 * weighted selection. Every Traffical SDK (JS, PHP, Swift) and the edge
 * runtime must produce byte-identical results for the same inputs.
 *
 * Why SHA-256 over the previous FNV-1a:
 * - FNV-1a passed single-layer uniformity but FAILED cross-experiment
 *   independence with realistic UUID/ULID unit keys and `lay_*` layer IDs:
 *   assignment in one layer could predict assignment in another, breaking
 *   orthogonal experiment assignment. SHA-256's avalanche behaviour removes
 *   that correlation.
 *
 * Contract:
 * - Input encoding: UTF-8 bytes.
 * - hashInt = first 64 bits of SHA-256(digest) as an unsigned big-endian integer.
 */

import { sha256 } from "@noble/hashes/sha2.js";

/**
 * Shared UTF-8 encoder. The canonical hashing domain is the UTF-8 byte
 * sequence of the input string (NOT UTF-16 code units), so that every
 * Traffical SDK produces identical results regardless of host string
 * representation.
 */
const UTF8_ENCODER = new TextEncoder();

/**
 * The domain-separation + version prefix for the assignment hash contract.
 * Bumping `v2` would intentionally re-roll every assignment.
 */
export const ASSIGNMENT_HASH_VERSION = "v2";

/**
 * Number of UTF-8 bytes in a string. Used for length-framing so that field
 * values containing the `:` or `|` separators cannot create ambiguous inputs.
 * Length is measured in UTF-8 bytes (not UTF-16 code units / grapheme
 * clusters) so the framing is identical across languages.
 */
export function utf8ByteLength(value: string): number {
  return UTF8_ENCODER.encode(value).length;
}

/**
 * Builds the canonical, length-framed, domain-separated assignment input
 * string for bucket computation.
 *
 * Format:
 *   traffical:assignment:v2|u:<unitLen>:<unitKeyValue>|l:<layerLen>:<layerId>
 *
 * Example:
 *   traffical:assignment:v2|u:26:01JZ0000008K7QF2J9M3P4X1A2B|l:12:lay_kjeJRrjh
 */
export function assignmentInput(unitKeyValue: string, layerId: string): string {
  const unitLen = utf8ByteLength(unitKeyValue);
  const layerLen = utf8ByteLength(layerId);
  return `traffical:assignment:${ASSIGNMENT_HASH_VERSION}|u:${unitLen}:${unitKeyValue}|l:${layerLen}:${layerId}`;
}

/**
 * Computes the SHA-256 digest of a string over its UTF-8 byte encoding.
 */
export function sha256Digest(input: string): Uint8Array {
  return sha256(UTF8_ENCODER.encode(input));
}

/**
 * Interprets the first 8 bytes of a digest as an unsigned big-endian 64-bit
 * integer. Returns a bigint so the full 64 bits are preserved exactly.
 */
export function hash64BE(digest: Uint8Array): bigint {
  let value = 0n;
  for (let i = 0; i < 8; i++) {
    value = (value << 8n) | BigInt(digest[i]);
  }
  return value;
}

/**
 * Convenience helper: the unsigned big-endian 64-bit hash of a string's
 * SHA-256 digest. This is the single primitive used for both bucket
 * assignment and weighted selection.
 */
export function hashInt64(input: string): bigint {
  return hash64BE(sha256Digest(input));
}
