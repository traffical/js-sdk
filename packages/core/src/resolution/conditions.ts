/**
 * Condition Evaluation
 *
 * Evaluates context predicates to determine policy eligibility.
 * Conditions are AND-ed together: all must match for a policy to apply.
 */

import type { Context, BundleCondition } from "../types/index.js";

/**
 * Evaluates a single condition against a context.
 *
 * @param condition - The condition to evaluate
 * @param context - The context to evaluate against
 * @returns True if the condition matches
 */
export function evaluateCondition(
  condition: BundleCondition,
  context: Context
): boolean {
  const { field, op, value, values } = condition;

  // Get the context value using dot notation
  const contextValue = getNestedValue(context, field);

  switch (op) {
    case "eq":
      return contextValue === value;

    case "neq":
      return contextValue !== value;

    case "in":
      if (!Array.isArray(values)) return false;
      return values.includes(contextValue);

    case "nin":
      if (!Array.isArray(values)) return true;
      return !values.includes(contextValue);

    case "gt":
      return (
        typeof contextValue === "number" && contextValue > (value as number)
      );

    case "gte":
      return (
        typeof contextValue === "number" && contextValue >= (value as number)
      );

    case "lt":
      return (
        typeof contextValue === "number" && contextValue < (value as number)
      );

    case "lte":
      return (
        typeof contextValue === "number" && contextValue <= (value as number)
      );

    case "contains":
      return (
        typeof contextValue === "string" &&
        typeof value === "string" &&
        contextValue.includes(value)
      );

    case "startsWith":
      return (
        typeof contextValue === "string" &&
        typeof value === "string" &&
        contextValue.startsWith(value)
      );

    case "endsWith":
      return (
        typeof contextValue === "string" &&
        typeof value === "string" &&
        contextValue.endsWith(value)
      );

    case "regex":
      if (typeof contextValue !== "string" || typeof value !== "string") {
        return false;
      }
      try {
        const regex = new RegExp(value);
        return regex.test(contextValue);
      } catch {
        return false;
      }

    case "exists":
      return contextValue !== undefined && contextValue !== null;

    case "notExists":
      return contextValue === undefined || contextValue === null;

    default:
      // Unknown operator, fail safe by not matching
      return false;
  }
}

/**
 * Evaluates all conditions against a context.
 * All conditions must match (AND logic).
 *
 * @param conditions - Array of conditions
 * @param context - The context to evaluate against
 * @returns True if all conditions match (or if there are no conditions)
 */
export function evaluateConditions(
  conditions: BundleCondition[],
  context: Context
): boolean {
  // Empty conditions = always match
  if (conditions.length === 0) {
    return true;
  }

  // All conditions must match (AND)
  return conditions.every((condition) => evaluateCondition(condition, context));
}

/**
 * Gets a nested value from an object using dot notation.
 *
 * @example
 * getNestedValue({ user: { name: "Alice" } }, "user.name") // "Alice"
 * getNestedValue({ tags: ["a", "b"] }, "tags.0") // "a"
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}

// =============================================================================
// Condition Builder Helpers
// =============================================================================

/**
 * Creates an equality condition.
 */
export function eq(field: string, value: unknown): BundleCondition {
  return { field, op: "eq", value };
}

/**
 * Creates a not-equal condition.
 */
export function neq(field: string, value: unknown): BundleCondition {
  return { field, op: "neq", value };
}

/**
 * Creates an "in" condition.
 */
export function inValues(field: string, values: unknown[]): BundleCondition {
  return { field, op: "in", values };
}

/**
 * Creates a "not in" condition.
 */
export function notIn(field: string, values: unknown[]): BundleCondition {
  return { field, op: "nin", values };
}

/**
 * Creates a greater-than condition.
 */
export function gt(field: string, value: number): BundleCondition {
  return { field, op: "gt", value };
}

/**
 * Creates a greater-than-or-equal condition.
 */
export function gte(field: string, value: number): BundleCondition {
  return { field, op: "gte", value };
}

/**
 * Creates a less-than condition.
 */
export function lt(field: string, value: number): BundleCondition {
  return { field, op: "lt", value };
}

/**
 * Creates a less-than-or-equal condition.
 */
export function lte(field: string, value: number): BundleCondition {
  return { field, op: "lte", value };
}

/**
 * Creates a string contains condition.
 */
export function contains(field: string, value: string): BundleCondition {
  return { field, op: "contains", value };
}

/**
 * Creates a string starts-with condition.
 */
export function startsWith(field: string, value: string): BundleCondition {
  return { field, op: "startsWith", value };
}

/**
 * Creates a string ends-with condition.
 */
export function endsWith(field: string, value: string): BundleCondition {
  return { field, op: "endsWith", value };
}

/**
 * Creates a regex match condition.
 */
export function regex(field: string, pattern: string): BundleCondition {
  return { field, op: "regex", value: pattern };
}

/**
 * Creates an exists condition.
 */
export function exists(field: string): BundleCondition {
  return { field, op: "exists" };
}

/**
 * Creates a not-exists condition.
 */
export function notExists(field: string): BundleCondition {
  return { field, op: "notExists" };
}

