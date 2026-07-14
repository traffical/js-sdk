/**
 * Events schema conformance.
 *
 * 1. Runs every vector in `events_conformance.json` through a real ajv
 *    validation of `events.schema.json`, asserting each payload's `valid`
 *    expectation (covers the 0.6.0 propensity fields, top-level configVersion,
 *    and the probability (0, 1] bounds).
 * 2. Validates a REAL engine-derived decision/exposure/track payload against
 *    the same schema, so the shapes the SDK actually emits are schema-clean.
 */
import { describe, test, expect } from "bun:test";
import Ajv, { type ValidateFunction } from "ajv";
import { decide } from "./engine.js";
import { loadSpecFixture, loadSpecSchema } from "./spec-fixtures.js";
import type { ConfigBundle } from "../types/index.js";

// strict:false so schema annotations don't fail compilation. Register
// `date-time` as a permissive no-op format (ajv-formats isn't a dependency);
// the conformance vectors exercise structural + numeric constraints, not
// wall-clock format validation.
const ajv = new Ajv({ allErrors: true, strict: false, formats: { "date-time": true } });
const validateEvent: ValidateFunction = ajv.compile(
  loadSpecSchema<object>("events.schema")
);

interface EventsConformanceFixture {
  testCases: Array<{ name: string; valid: boolean; event: unknown }>;
}

describe("events_conformance.json vectors", () => {
  const fixture = loadSpecFixture<EventsConformanceFixture>("events_conformance");

  for (const tc of fixture.testCases) {
    test(`${tc.name} => ${tc.valid ? "valid" : "invalid"}`, () => {
      const ok = validateEvent(tc.event);
      if (ok !== tc.valid) {
        // Surface ajv errors to make failures debuggable.
        throw new Error(
          `expected valid=${tc.valid}, got ${ok}. errors=${JSON.stringify(validateEvent.errors)}`
        );
      }
      expect(ok).toBe(tc.valid);
    });
  }
});

describe("real engine payloads validate against events.schema.json", () => {
  const bundle = loadSpecFixture<ConfigBundle>("bundle_contextual");

  test("a decision-derived exposure event is schema-valid", () => {
    const decision = decide(
      bundle,
      { userId: "user-low-engage", engagement_score: 2.0, device_type: "desktop" },
      { "ui.heroVariant": "default" }
    );

    // Build the canonical exposure payload the clients emit (S4 shape): one
    // event carrying the non-attributionOnly resolved layers with propensity.
    const exposure = {
      type: "exposure",
      id: "exp_test",
      decisionId: decision.decisionId,
      orgId: "org_test",
      projectId: "proj_test",
      env: "production",
      unitKey: decision.metadata.unitKeyValue,
      timestamp: decision.metadata.timestamp,
      assignments: decision.assignments,
      layers: decision.metadata.layers.filter((l) => l.policyId && l.allocationName),
      configVersion: decision.metadata.configVersion,
      sdkName: "core",
      sdkVersion: "0.0.0-test",
    };

    const ok = validateEvent(exposure);
    if (!ok) throw new Error(JSON.stringify(validateEvent.errors));
    expect(ok).toBe(true);
    // The chosen contextual allocation carries a propensity in (0, 1].
    const heroLayer = exposure.layers.find((l) => l.layerId === "layer_hero");
    expect(heroLayer?.probability).toBeGreaterThan(0);
    expect(heroLayer?.probability).toBeLessThanOrEqual(1);
  });

  test("a decision event is schema-valid", () => {
    const decision = decide(
      bundle,
      { userId: "user-high-engage", engagement_score: 9.0, device_type: "mobile" },
      { "ui.heroVariant": "default" }
    );
    const decisionEvent = {
      type: "decision",
      id: decision.decisionId,
      orgId: "org_test",
      projectId: "proj_test",
      env: "production",
      unitKey: decision.metadata.unitKeyValue,
      timestamp: decision.metadata.timestamp,
      requestedParameters: ["ui.heroVariant"],
      assignments: decision.assignments,
      layers: decision.metadata.layers,
      configVersion: decision.metadata.configVersion,
      sdkName: "core",
      sdkVersion: "0.0.0-test",
      latencyMs: 1,
    };
    const ok = validateEvent(decisionEvent);
    if (!ok) throw new Error(JSON.stringify(validateEvent.errors));
    expect(ok).toBe(true);
  });

  test("a track event with value/values/eventTimestamp is schema-valid", () => {
    const trackEvent = {
      type: "track",
      id: "trk_test",
      orgId: "org_test",
      projectId: "proj_test",
      env: "production",
      unitKey: "user-low-engage",
      timestamp: new Date().toISOString(),
      event: "purchase",
      value: 99.99,
      values: { revenue: 99.99, items: 3 },
      properties: { orderId: "ord_1" },
      eventTimestamp: new Date().toISOString(),
      sdkName: "core",
      sdkVersion: "0.0.0-test",
    };
    const ok = validateEvent(trackEvent);
    if (!ok) throw new Error(JSON.stringify(validateEvent.errors));
    expect(ok).toBe(true);
  });
});
