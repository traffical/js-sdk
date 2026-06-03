/**
 * FNV-1a Hash Function
 *
 * A simple, fast hash function with good distribution properties.
 * Used by Google's experimentation system for bucket assignment.
 *
 * This implementation produces consistent results across all platforms
 * and is the canonical hash for Traffical SDKs.
 */

const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;

/**
 * Shared UTF-8 encoder. The canonical hashing domain is the UTF-8 byte
 * sequence of the input string (NOT UTF-16 code units), so that every
 * Traffical SDK — regardless of host string representation — produces
 * identical buckets for non-ASCII unit keys.
 */
const UTF8_ENCODER = new TextEncoder();

/**
 * Computes the FNV-1a hash of a string.
 *
 * The string is first encoded to UTF-8 bytes, then each byte is folded into
 * the hash. For ASCII input this is identical to hashing code units, so all
 * existing ASCII fixtures are unaffected (e.g. `user-abc:layer_ui` → 551).
 *
 * @param input - The string to hash
 * @returns Unsigned 32-bit integer hash
 */
export function fnv1a(input: string): number {
  let hash = FNV_OFFSET_BASIS;

  const bytes = UTF8_ENCODER.encode(input);
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, FNV_PRIME);
  }

  // Convert to unsigned 32-bit integer
  return hash >>> 0;
}

