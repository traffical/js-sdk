/**
 * Resolution Module
 *
 * Exports all resolution-related functions.
 */

export {
  resolveParameters,
  decide,
  getUnitKeyValue,
  type ResolveOptions,
} from "./engine.js";

export {
  evaluateCondition,
  evaluateConditions,
  // Condition builders
  eq,
  neq,
  inValues,
  notIn,
  gt,
  gte,
  lt,
  lte,
  contains,
  startsWith,
  endsWith,
  regex,
  exists,
  notExists,
} from "./conditions.js";

