import { describe, test, expect, mock } from "bun:test";
import { ErrorPolicy } from "./error-policy.ts";
import { validateConfigBundle } from "./validate-bundle.ts";

// =============================================================================
// ErrorPolicy — the tier rules
// =============================================================================

describe("ErrorPolicy — Tier 2 (resolution)", () => {
  test("default mode contains the error and returns the fallback", () => {
    const policy = new ErrorPolicy();
    const result = policy.resolve("decide", () => { throw new Error("boom"); }, () => "fallback");
    expect(result).toBe("fallback");
    expect(policy.getDiagnostics().resolutionErrors).toBe(1);
  });

  test('"throw" mode rethrows the original error', () => {
    const policy = new ErrorPolicy({ onResolutionError: "throw" });
    expect(() => policy.resolve("decide", () => { throw new Error("boom"); }, () => "fallback"))
      .toThrow("boom");
    // Still counted and reported before rethrowing.
    expect(policy.getDiagnostics().resolutionErrors).toBe(1);
  });

  test("the fallback thunk is not invoked on the happy path", () => {
    const fallback = mock(() => "fallback");
    const policy = new ErrorPolicy();
    expect(policy.resolve("decide", () => "ok", fallback)).toBe("ok");
    expect(fallback).toHaveBeenCalledTimes(0);
  });

  test("resolveAsync mirrors resolve", async () => {
    const policy = new ErrorPolicy();
    const value = await policy.resolveAsync("init", async () => { throw new Error("x"); }, () => 7);
    expect(value).toBe(7);

    const strict = new ErrorPolicy({ onResolutionError: "throw" });
    await expect(strict.resolveAsync("init", async () => { throw new Error("x"); }, () => 7))
      .rejects.toThrow("x");
  });
});

describe("ErrorPolicy — Tier 1 (side effects)", () => {
  test("never rethrows, even in strict mode", () => {
    const policy = new ErrorPolicy({ onResolutionError: "throw" });
    // This is the whole point of the tiering: an integrator who asked for loud
    // failures still must not get an exception from their own logging sink.
    expect(() =>
      policy.sideEffect("assignmentLogger", "assignmentLog", () => {
        throw new Error("queue full");
      }),
    ).not.toThrow();
    expect(policy.getDiagnostics().droppedAssignmentLogs).toBe(1);
  });

  test("counts each kind separately", () => {
    const policy = new ErrorPolicy();
    const boom = () => { throw new Error("boom"); };
    policy.sideEffect("a", "assignmentLog", boom);
    policy.sideEffect("b", "eventLog", boom);
    policy.sideEffect("c", "other", boom);
    const d = policy.getDiagnostics();
    expect(d.droppedAssignmentLogs).toBe(1);
    expect(d.droppedEventLogs).toBe(1);
    expect(d.sideEffectErrors).toBe(1);
    expect(d.resolutionErrors).toBe(0);
  });

  test("sideEffectAsync contains rejected promises", async () => {
    const policy = new ErrorPolicy({ onResolutionError: "throw" });
    await policy.sideEffectAsync("flush", "eventLog", async () => { throw new Error("net"); });
    expect(policy.getDiagnostics().droppedEventLogs).toBe(1);
  });
});

describe("ErrorPolicy — onError reporting", () => {
  test("fires for both tiers and deduplicates per tag:name:message", () => {
    const onError = mock((_tag: string, _err: Error) => {});
    const policy = new ErrorPolicy({ onError });

    policy.resolve("decide", () => { throw new Error("same"); }, () => null);
    policy.resolve("decide", () => { throw new Error("same"); }, () => null);
    expect(onError).toHaveBeenCalledTimes(1);

    // A different message on the same tag is a distinct error, not a repeat.
    policy.resolve("decide", () => { throw new Error("other"); }, () => null);
    expect(onError).toHaveBeenCalledTimes(2);

    // Same message under a different tag is also distinct — dedup on the
    // triple, not just the error name (Statsig dedups on name alone and
    // therefore drops the second distinct TypeError anywhere in the SDK).
    policy.sideEffect("assignmentLogger", "assignmentLog", () => { throw new Error("same"); });
    expect(onError).toHaveBeenCalledTimes(3);
  });

  test("a throwing onError is itself contained", () => {
    const policy = new ErrorPolicy({ onError: () => { throw new Error("reporter exploded"); } });
    expect(() => policy.sideEffect("t", "other", () => { throw new Error("boom"); })).not.toThrow();
  });

  test("non-Error throws are normalized", () => {
    const onError = mock((_tag: string, _err: Error) => {});
    const policy = new ErrorPolicy({ onError });
    policy.resolve("decide", () => { throw "a string"; }, () => null);
    expect(onError.mock.calls[0]?.[1]).toBeInstanceOf(Error);
    expect(policy.getDiagnostics().lastError?.message).toBe("a string");
  });
});

// =============================================================================
// validateConfigBundle — reject whole, never partially apply
// =============================================================================

function validBundle(): Record<string, unknown> {
  return {
    version: "2024-01-01T00:00:00.000Z",
    orgId: "org_1",
    projectId: "proj_1",
    env: "production",
    hashing: { unitKey: "userId", bucketCount: 1000 },
    parameters: [{ key: "ui.color", type: "string", default: "#000", layerId: "layer_1" }],
    layers: [
      {
        id: "layer_1",
        policies: [
          {
            id: "policy_1",
            key: "color-test",
            state: "running",
            kind: "static",
            conditions: [],
            allocations: [
              { id: "a1", key: "t", name: "treatment", bucketRange: [0, 999], overrides: {} },
            ],
          },
        ],
      },
    ],
  };
}

describe("validateConfigBundle", () => {
  test("accepts a well-formed bundle", () => {
    expect(validateConfigBundle(validBundle())).toEqual({ ok: true });
  });

  test.each([
    ["not an object", 42, ""],
    ["missing hashing", { ...validBundle(), hashing: undefined }, "hashing"],
    ["empty unitKey", { ...validBundle(), hashing: { unitKey: "", bucketCount: 10 } }, "hashing.unitKey"],
    ["bucketCount 0", { ...validBundle(), hashing: { unitKey: "userId", bucketCount: 0 } }, "hashing.bucketCount"],
    ["parameters not an array", { ...validBundle(), parameters: {} }, "parameters"],
    ["layers not an array", { ...validBundle(), layers: {} }, "layers"],
  ])("rejects %s", (_label, bundle, path) => {
    const result = validateConfigBundle(bundle);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toBe(path);
  });

  test("rejects a layer whose policies is missing — the nested crash", () => {
    // This is the exact shape that threw `TypeError: undefined is not an
    // object (evaluating 'layer.policies')` straight out of decide().
    const bundle = validBundle();
    (bundle.layers as Array<Record<string, unknown>>)[0]!.policies = undefined;
    const result = validateConfigBundle(bundle);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toBe("layers[0].policies");
  });

  test("rejects a policy whose allocations or conditions is missing", () => {
    for (const field of ["allocations", "conditions"]) {
      const bundle = validBundle();
      const policy = (bundle.layers as any)[0].policies[0];
      policy[field] = undefined;
      const result = validateConfigBundle(bundle);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.path).toBe(`layers[0].policies[0].${field}`);
    }
  });

  test.each([
    ["not an array", "0-999"],
    ["wrong arity", [0, 100, 200]],
    ["non-integer bounds", [0.5, 999]],
    ["inverted", [999, 0]],
    ["negative", [-1, 999]],
  ])("rejects a bucketRange that is %s", (_label, range) => {
    const bundle = validBundle();
    (bundle.layers as any)[0].policies[0].allocations[0].bucketRange = range;
    const result = validateConfigBundle(bundle);
    expect(result.ok).toBe(false);
    // A malformed range is the failure that does not announce itself: PHP's
    // parser coerces one into a live one-bucket range rather than rejecting.
    if (!result.ok) expect(result.path).toBe("layers[0].policies[0].allocations[0].bucketRange");
  });

  test("does not reject on values it has no business judging", () => {
    const bundle = validBundle();
    // Any JSON value is a legal parameter default / override by design.
    (bundle.parameters as any)[0].default = { nested: [1, 2, 3] };
    (bundle.layers as any)[0].policies[0].allocations[0].overrides = { "ui.color": null };
    expect(validateConfigBundle(bundle).ok).toBe(true);
  });

  test("reports a path precise enough to debug", () => {
    const bundle = validBundle();
    (bundle.layers as any)[0].policies[0].allocations.push({
      id: "a2", name: "control", bucketRange: [0, "nope"], overrides: {},
    });
    const result = validateConfigBundle(bundle);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.path).toBe("layers[0].policies[0].allocations[1].bucketRange");
      expect(result.reason).toContain("integers");
    }
  });
});
