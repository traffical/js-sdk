import { describe, test, expect } from "bun:test";
import { TargetingKeyMissingError } from "@openfeature/core";
import { buildTrafficalContext } from "./context.js";

describe("buildTrafficalContext", () => {
  test("writes the targeting value under the bundle's unit-key field", () => {
    const ctx = buildTrafficalContext({
      targetingKey: "user-123",
      attributes: { plan: "pro", country: "US" },
      unitKeyField: "userId",
    });

    // preserved attributes
    expect(ctx.plan).toBe("pro");
    expect(ctx.country).toBe("US");
    // targetingKey echoed
    expect(ctx.targetingKey).toBe("user-123");
    // and crucially written under the bundle's unit-key field
    expect(ctx.userId).toBe("user-123");
  });

  test("uses a non-default unit-key field when the bundle buckets on it", () => {
    const ctx = buildTrafficalContext({
      targetingKey: "cust-9",
      attributes: {},
      unitKeyField: "customerId",
    });
    expect(ctx.customerId).toBe("cust-9");
    expect(ctx.targetingKey).toBe("cust-9");
  });

  test("degrades to writing only 'targetingKey' when the bundle isn't loaded", () => {
    const ctx = buildTrafficalContext({
      targetingKey: "anon-1",
      attributes: { a: 1 },
      unitKeyField: null,
    });
    expect(ctx.targetingKey).toBe("anon-1");
    expect(ctx.a).toBe(1);
    // no stray field written
    expect(Object.keys(ctx).sort()).toEqual(["a", "targetingKey"]);
  });

  test("attributes never override the mapped unit-key field", () => {
    // even if the caller passes a bogus userId attribute, the targeting value wins
    const ctx = buildTrafficalContext({
      targetingKey: "real-user",
      attributes: { userId: "spoofed" },
      unitKeyField: "userId",
    });
    expect(ctx.userId).toBe("real-user");
  });

  test("throws TargetingKeyMissingError when key is undefined", () => {
    expect(() =>
      buildTrafficalContext({ targetingKey: undefined, attributes: {}, unitKeyField: "userId" })
    ).toThrow(TargetingKeyMissingError);
  });

  test("throws TargetingKeyMissingError when key is empty string", () => {
    expect(() =>
      buildTrafficalContext({ targetingKey: "", attributes: {}, unitKeyField: "userId" })
    ).toThrow(TargetingKeyMissingError);
  });

  test("throws TargetingKeyMissingError when key is null", () => {
    expect(() =>
      buildTrafficalContext({
        targetingKey: null as unknown as undefined,
        attributes: {},
        unitKeyField: "userId",
      })
    ).toThrow(TargetingKeyMissingError);
  });
});
