/**
 * Resolution Module
 *
 * Exports all resolution-related functions.
 */

export {
  resolveParameters,
  decide,
  getUnitKeyValue,
  getUnitKeyField,
  getParameterLayerId,
  type ResolveOptions,
} from "./engine.js";

export {
  evaluateCondition,
  evaluateConditions,
  getNestedValue,
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

