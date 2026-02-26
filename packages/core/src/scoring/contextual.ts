/**
 * Contextual Bandit Scoring
 *
 * Pure functions for computing personalized allocation probabilities
 * from a trained linear contextual model. Used by the resolution engine
 * when a policy has a `contextualModel` field.
 *
 * Scoring pipeline:
 *   1. Compute linear score per allocation: intercept + SUM(coef * feature)
 *   2. Apply softmax with gamma temperature to get probabilities
 *   3. Enforce action probability floor (minimum exploration)
 *   4. Deterministic weighted selection via FNV-1a hash
 */

import type {
  BundlePolicy,
  BundleAllocation,
  BundleAllocationCoefficients,
  BundleContextualModel,
  Context,
} from "../types/index.js";
import { weightedSelection } from "../hashing/weighted.js";

/**
 * Computes the linear score for a single allocation given context features.
 *
 * score = intercept
 *       + SUM_numeric( coef_i * context[key_i]  OR  missing_i )
 *       + SUM_categorical( values[context[key_j]]  OR  missing_j )
 */
export function computeAllocationScore(
  coefficients: BundleAllocationCoefficients,
  context: Context
): number {
  let score = coefficients.intercept;

  for (const { key, coef, missing } of coefficients.numeric) {
    const value = context[key];
    score += typeof value === "number" ? coef * value : missing;
  }

  for (const { key, values, missing } of coefficients.categorical) {
    const value = context[key];
    const strValue = value !== undefined && value !== null ? String(value) : null;
    score +=
      strValue !== null && strValue in values ? values[strValue] : missing;
  }

  return score;
}

/**
 * Applies softmax with temperature (gamma) to convert raw scores to probabilities.
 *
 * Uses the numerically stable variant: subtract max before exponentiation.
 * Lower gamma makes the distribution more peaked (exploitative);
 * higher gamma makes it more uniform (explorative).
 */
export function softmaxProbabilities(
  scores: number[],
  gamma: number
): number[] {
  if (scores.length === 0) return [];
  if (scores.length === 1) return [1.0];

  const safeGamma = Math.max(gamma, 1e-10);
  const scaled = scores.map((s) => s / safeGamma);
  const maxScaled = Math.max(...scaled);
  const exps = scaled.map((s) => Math.exp(s - maxScaled));
  const sumExp = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sumExp);
}

/**
 * Enforces a minimum probability floor on each allocation and renormalizes.
 *
 * Any allocation below the floor is raised to it; surplus probability
 * is deducted proportionally from allocations above the floor.
 */
export function applyProbabilityFloor(
  probs: number[],
  floor: number
): number[] {
  if (probs.length === 0) return [];
  if (floor <= 0) return probs;

  const n = probs.length;
  const maxFloor = 1.0 / n;
  const effectiveFloor = Math.min(floor, maxFloor);

  const floored = probs.map((p) => Math.max(p, effectiveFloor));
  const sum = floored.reduce((a, b) => a + b, 0);

  if (sum === 0) return Array(n).fill(1 / n);
  return floored.map((p) => p / sum);
}

/**
 * Resolves a contextual policy to a specific allocation using the trained model.
 *
 * Steps:
 *   1. Score each allocation using its coefficients (or defaultAllocationScore)
 *   2. Convert scores to probabilities via softmax(gamma)
 *   3. Apply the action probability floor
 *   4. Deterministically select using weightedSelection with a hash seed
 *
 * @returns The selected allocation, or null if the policy has no allocations
 */
export function resolveContextualPolicy(
  policy: BundlePolicy,
  context: Context,
  unitKeyValue: string
): BundleAllocation | null {
  const model = policy.contextualModel;
  if (!model) return null;
  if (policy.allocations.length === 0) return null;

  const scores = computeContextualScores(model, policy.allocations, context);
  const probs = softmaxProbabilities(scores, model.gamma);
  const floored = applyProbabilityFloor(probs, model.actionProbabilityFloor);

  const seed = `ctx:${unitKeyValue}:${policy.id}`;
  const selectedIndex = weightedSelection(floored, seed);

  return policy.allocations[selectedIndex];
}

/**
 * Computes raw scores for all allocations in a policy.
 */
function computeContextualScores(
  model: BundleContextualModel,
  allocations: BundleAllocation[],
  context: Context
): number[] {
  return allocations.map((alloc) => {
    const coefficients = model.coefficients[alloc.name];
    if (!coefficients) return model.defaultAllocationScore;
    return computeAllocationScore(coefficients, context);
  });
}
