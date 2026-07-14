/**
 * Regression tests for the hook dependency-key stringify. The previous
 * implementation used `JSON.stringify(obj, Object.keys(obj).sort())`, whose
 * array replacer only allowlists TOP-LEVEL keys and never reorders nested
 * objects — so a change to a nested context/defaults value produced the SAME
 * key and stranded the hook on stale resolution. These assert the recursive
 * sorted stringify detects nested changes and stays order-independent.
 */
import { describe, it, expect } from "bun:test";
import { createStableKey } from "../hooks.js";

describe("createStableKey (react-native)", () => {
  it("detects a change in a NESTED value", () => {
    const a = createStableKey({ user: { plan: "free" } });
    const b = createStableKey({ user: { plan: "pro" } });
    expect(a).not.toBe(b);
  });

  it("detects a change in a deeply nested value", () => {
    const a = createStableKey({ a: { b: { c: 1 } } });
    const b = createStableKey({ a: { b: { c: 2 } } });
    expect(a).not.toBe(b);
  });

  it("is stable across top-level AND nested key ordering", () => {
    const a = createStableKey({ x: 1, nested: { p: 1, q: 2 } });
    const b = createStableKey({ nested: { q: 2, p: 1 }, x: 1 });
    expect(a).toBe(b);
  });

  it("detects nested array element changes", () => {
    const a = createStableKey({ tags: ["a", "b"] });
    const b = createStableKey({ tags: ["a", "c"] });
    expect(a).not.toBe(b);
  });

  it("handles primitives, null and undefined without throwing", () => {
    expect(createStableKey(undefined)).toBeDefined();
    expect(createStableKey(null)).toBeDefined();
    expect(createStableKey("s")).toBe(createStableKey("s"));
    expect(createStableKey(1)).not.toBe(createStableKey(2));
  });
});
