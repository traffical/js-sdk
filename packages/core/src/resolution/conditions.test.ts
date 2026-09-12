/**
 * Unit tests for condition field lookup (spec "Field lookup"): the literal
 * flat key is tried first, then dot-path traversal. Operator semantics are
 * covered by the conformance vectors; this file pins the lookup rule itself.
 */
import { describe, test, expect } from "bun:test";
import { evaluateCondition, evaluateConditions, getNestedValue } from "./conditions.js";

describe("getNestedValue: flat key first, then nested", () => {
  test("literal dotted key resolves without traversal", () => {
    expect(getNestedValue({ "url.pathname": "/pricing" }, "url.pathname")).toBe("/pricing");
  });

  test("nested traversal still works when no flat key exists", () => {
    expect(getNestedValue({ url: { pathname: "/pricing" } }, "url.pathname")).toBe("/pricing");
    expect(getNestedValue({ a: { b: { c: 7 } } }, "a.b.c")).toBe(7);
    expect(getNestedValue({ tags: ["a", "b"] }, "tags.0")).toBe("a");
    expect(getNestedValue({ tags: ["a", "b"] }, "tags.length")).toBe(2);
  });

  test("flat key wins when both shapes are present", () => {
    const ctx = { "a.b": 1, a: { b: 2 } };
    expect(getNestedValue(ctx, "a.b")).toBe(1);
  });

  test("a flat key holding undefined or null stops the lookup (treated as absent)", () => {
    expect(getNestedValue({ "a.b": undefined, a: { b: 2 } }, "a.b")).toBeUndefined();
    expect(getNestedValue({ "a.b": null, a: { b: 2 } }, "a.b")).toBeNull();
  });

  test("undotted fields behave identically under both steps", () => {
    expect(getNestedValue({ plan: "pro" }, "plan")).toBe("pro");
    expect(getNestedValue({}, "plan")).toBeUndefined();
  });

  test("missing paths never throw", () => {
    expect(getNestedValue({}, "url.pathname")).toBeUndefined();
    expect(getNestedValue({ url: null }, "url.pathname")).toBeUndefined();
    expect(getNestedValue({ url: "string" }, "url.pathname")).toBeUndefined();
    expect(getNestedValue({ url: 42 }, "url.pathname")).toBeUndefined();
  });

  test("inherited properties are not treated as flat keys", () => {
    // "toString" exists on Object.prototype but is not an own property.
    expect(getNestedValue({}, "toString")).toBe(Object.prototype.toString);
    // A null-prototype object has no inherited keys at all.
    expect(getNestedValue(Object.create(null) as Record<string, unknown>, "a.b")).toBeUndefined();
  });
});

describe("evaluateCondition with dotted fields", () => {
  const cond = { field: "url.pathname", op: "eq" as const, value: "/pricing" };

  test("matches the redirect-plugin flat key shape", () => {
    expect(evaluateCondition(cond, { "url.pathname": "/pricing" })).toBe(true);
  });

  test("matches the nested shape", () => {
    expect(evaluateCondition(cond, { url: { pathname: "/pricing" } })).toBe(true);
  });

  test("flat key takes precedence over nested in both directions", () => {
    expect(
      evaluateCondition(cond, { "url.pathname": "/pricing", url: { pathname: "/checkout" } })
    ).toBe(true);
    expect(
      evaluateCondition(cond, { "url.pathname": "/checkout", url: { pathname: "/pricing" } })
    ).toBe(false);
  });

  test("strict typing is preserved after flat lookup", () => {
    expect(evaluateCondition({ field: "a.b", op: "gt", value: 1 }, { "a.b": "2" })).toBe(false);
    expect(evaluateCondition({ field: "a.b", op: "gt", value: 1 }, { "a.b": 2 })).toBe(true);
  });

  test("exists / notExists see a null flat key as absent", () => {
    expect(evaluateCondition({ field: "a.b", op: "exists" }, { "a.b": null, a: { b: 1 } })).toBe(false);
    expect(evaluateCondition({ field: "a.b", op: "notExists" }, { "a.b": null, a: { b: 1 } })).toBe(true);
  });

  test("missing under both steps does not match and does not throw", () => {
    expect(evaluateCondition(cond, { referrer: "x" })).toBe(false);
    expect(evaluateConditions([cond], {})).toBe(false);
  });
});
