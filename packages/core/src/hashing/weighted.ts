/**
 * Weighted Selection
 *
 * Deterministic weighted selection using FNV-1a hashing.
 * Used by both per-entity resolution and contextual bandit scoring.
 */

import { fnv1a } from "./fnv1a.js";

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

  const hash = fnv1a(seed);
  const random = (hash % 10000) / 10000;

  let cumulative = 0;
  for (let i = 0; i < weights.length; i++) {
    cumulative += weights[i];
    if (random < cumulative) {
      return i;
    }
  }

  return weights.length - 1;
}
