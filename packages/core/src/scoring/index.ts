/**
 * Scoring Module
 *
 * Exports contextual bandit scoring functions.
 */

export {
  computeAllocationScore,
  softmaxProbabilities,
  applyProbabilityFloor,
  resolveContextualPolicy,
  resolveContextualPolicyDetailed,
  type ContextualResolution,
} from "./contextual.js";
