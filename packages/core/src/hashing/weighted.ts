/**
 * Weighted Selection
 *
 * Deterministic weighted selection using the SHA-256 v2 assignment hash.
 * Used by both per-entity resolution and contextual bandit scoring.
 *
 * The seed string is hashed with SHA-256; the first 64 bits (unsigned,
 * big-endian) are reduced to a uniform value in [0, 1) via mod 2^53 (which
 * keeps full IEEE-754 double precision and stays within a signed 64-bit
 * integer for the PHP/Swift implementations).
 */

import { hashInt64 } from "./assignment-hash.js";

/** 2^53 — the largest exactly-representable power of two in a JS number. */
const UNIFORM_MODULUS = 1n << 53n;
const UNIFORM_DENOMINATOR = 9007199254740992; // 2^53

/**
 * Performs deterministic weighted selection using a hash.
 *
 * Uses the seed string to deterministically select an index based on weights.
 * This ensures the same seed always produces the same selection for a given
 * weight distribution.
 *
 * @param weights - Array of weights (should sum to 1.0)
 * @param seed - Seed string for deterministic hashing
 * @returns Index of selected entry
 */
export function weightedSelection(weights: number[], seed: string): number {
  if (weights.length === 0) return 0;
  if (weights.length === 1) return 0;

  const hashInt = hashInt64(seed);
  const random = Number(hashInt % UNIFORM_MODULUS) / UNIFORM_DENOMINATOR;

  let cumulative = 0;
  for (let i = 0; i < weights.length; i++) {
    cumulative += weights[i];
    if (random < cumulative) {
      return i;
    }
  }

  return weights.length - 1;
}
