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
 * Computes the FNV-1a hash of a string.
 *
 * @param input - The string to hash
 * @returns Unsigned 32-bit integer hash
 */
export function fnv1a(input: string): number {
  let hash = FNV_OFFSET_BASIS;

  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }

  // Convert to unsigned 32-bit integer
  return hash >>> 0;
}

