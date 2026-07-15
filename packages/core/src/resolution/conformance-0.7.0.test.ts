/**
 * Spec 0.7.0 (drift-remediation) conformance.
 *
 * Wires the hand-authored 0.7.0 fixtures plus the previously-skipped unicode
 * and contextual-boundary vectors through the real resolution engine. Fixtures
 * are loaded via the portable loader (local sibling sdk-spec checkout on the
 * published >= 0.7.0 package). See ./spec-fixtures.ts.
 */
import { describe, test, expect } from "bun:test";
import { decide, resolveParameters } from "./engine.js";
import { computeBucket } from "../hashing/bucket.js";
import { loadSpecFixture } from "./spec-fixtures.js";
import type { ConfigBundle, ParameterValue } from "../types/index.js";

/** Derives a caller `defaults` map from a bundle's declared parameters. */
function defaultsFromBundle(bundle: ConfigBundle): Record<string, ParameterValue> {
  const defaults: Record<string, ParameterValue> = {};
  for (const p of bundle.parameters) defaults[p.key] = p.default;
  return defaults;
}

interface BundleCaseFixture {
  bundle: string;
  testCases: Array<{
    name: string;
    context: Record<string, unknown>;
    expectedHashing?: Record<string, { unitKeyValue?: string; bucket: number }>;
    expectedAssignments?: Record<string, ParameterValue>;
    expectedLayers?: Array<{
      layerId: string;
      bucket: number;
      policyId?: string;
      allocationName?: string;
    }>;
    expectedAllocation?: string;
    expectedScoring?: { probabilities: number[]; selectedIndex: number };
  }>;
}

function loadPair(bundleName: string, expectedName: string): {
  bundle: ConfigBundle;
  fixture: BundleCaseFixture;
} {
  const bundle = loadSpecFixture<ConfigBundle>(bundleName);
  const fixture = loadSpecFixture<BundleCaseFixture>(expectedName);
  return { bundle, fixture };
}

// ---------------------------------------------------------------------------
// S1 — empty / whitespace layer unitKey override => skip the layer
// ---------------------------------------------------------------------------
describe("S1: empty/whitespace layer unitKey override is skipped", () => {
  const { bundle, fixture } = loadPair("bundle_empty_unit_key", "expected_empty_unit_key");

  for (const tc of fixture.testCases) {
    test(tc.name, () => {
      const decision = decide(bundle, tc.context, defaultsFromBundle(bundle));

      for (const [key, expected] of Object.entries(tc.expectedAssignments ?? {})) {
        expect(decision.assignments[key]).toEqual(expected);
      }

      for (const expLayer of tc.expectedLayers ?? []) {
        const got = decision.metadata.layers.find((l) => l.layerId === expLayer.layerId);
        expect(got).toBeDefined();
        expect(got!.bucket).toBe(expLayer.bucket);
        if (expLayer.bucket === -1) {
          // Skipped layers carry no policy/allocation …
          expect(got!.policyId).toBeUndefined();
          expect(got!.allocationName).toBeUndefined();
          // … and, when the override was the INVALID (empty/whitespace) case,
          // no unitKey/unitKeyValue metadata at all.
          expect(got!.unitKey).toBeUndefined();
          expect(got!.unitKeyValue).toBeUndefined();
        } else {
          expect(got!.policyId).toBe(expLayer.policyId);
          expect(got!.allocationName).toBe(expLayer.allocationName);
        }
      }
    });
  }
});

// ---------------------------------------------------------------------------
// S2 — canonical numeric unit-key stringification (ECMAScript Number::toString)
// ---------------------------------------------------------------------------
describe("S2: numeric unit key stringification is canonical", () => {
  const { bundle, fixture } = loadPair("bundle_numeric_unit_key", "expected_numeric_unit_key");

  for (const tc of fixture.testCases) {
    test(tc.name, () => {
      const decision = decide(bundle, tc.context, defaultsFromBundle(bundle));

      for (const [layerId, expected] of Object.entries(tc.expectedHashing ?? {})) {
        const got = decision.metadata.layers.find((l) => l.layerId === layerId);
        expect(got).toBeDefined();
        expect(got!.bucket).toBe(expected.bucket);
        // Independently recompute the bucket from the canonical string form.
        expect(computeBucket(expected.unitKeyValue!, layerId, bundle.hashing.bucketCount)).toBe(
          expected.bucket
        );
      }
      for (const [key, expected] of Object.entries(tc.expectedAssignments ?? {})) {
        expect(decision.assignments[key]).toEqual(expected);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// S5 — omitted relational-condition value never matches
// ---------------------------------------------------------------------------
describe("S5: omitted relational-condition value never matches", () => {
  const { bundle, fixture } = loadPair(
    "bundle_conditions_omitted",
    "expected_conditions_omitted"
  );

  for (const tc of fixture.testCases) {
    test(tc.name, () => {
      const decision = decide(bundle, tc.context, defaultsFromBundle(bundle));
      for (const [key, expected] of Object.entries(tc.expectedAssignments ?? {})) {
        expect(decision.assignments[key]).toEqual(expected);
      }
      for (const expLayer of tc.expectedLayers ?? []) {
        const got = decision.metadata.layers.find((l) => l.layerId === expLayer.layerId);
        expect(got).toBeDefined();
        expect(got!.bucket).toBe(expLayer.bucket);
        expect(got!.policyId).toBe(expLayer.policyId);
        expect(got!.allocationName).toBe(expLayer.allocationName);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// UTF-8 byte hashing (previously-skipped unicode vectors)
// ---------------------------------------------------------------------------
describe("unicode: SHA-256 v2 over UTF-8 bytes", () => {
  const { bundle, fixture } = loadPair("bundle_unicode", "expected_unicode");

  for (const tc of fixture.testCases) {
    test(tc.name, () => {
      const decision = decide(bundle, tc.context, defaultsFromBundle(bundle));
      for (const [layerId, expected] of Object.entries(tc.expectedHashing ?? {})) {
        const got = decision.metadata.layers.find((l) => l.layerId === layerId);
        expect(got).toBeDefined();
        expect(got!.bucket).toBe(expected.bucket);
      }
      for (const [key, expected] of Object.entries(tc.expectedAssignments ?? {})) {
        expect(decision.assignments[key]).toEqual(expected);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// S6 + boundary — contextual softmax guards & near-gridline selection
// ---------------------------------------------------------------------------
describe.each([
  ["S6 safeGamma", "bundle_contextual_gamma_zero", "expected_contextual_gamma_zero"],
  ["S6 effectiveFloor", "bundle_contextual_high_floor", "expected_contextual_high_floor"],
  ["contextual boundary", "bundle_contextual_boundary", "expected_contextual_boundary"],
])("%s", (_label, bundleName, expectedName) => {
  const { bundle, fixture } = loadPair(bundleName, expectedName);

  for (const tc of fixture.testCases) {
    test(tc.name, () => {
      const decision = decide(bundle, tc.context, defaultsFromBundle(bundle));

      for (const [key, expected] of Object.entries(tc.expectedAssignments ?? {})) {
        expect(decision.assignments[key]).toEqual(expected);
      }

      // The chosen allocation and its logged propensity must come from the
      // floored/guarded softmax distribution the fixture locks.
      const layer = decision.metadata.layers.find((l) => l.allocationName === tc.expectedAllocation);
      expect(layer).toBeDefined();
      expect(layer!.allocationName).toBe(tc.expectedAllocation);
      if (tc.expectedScoring) {
        const expectedProb = tc.expectedScoring.probabilities[tc.expectedScoring.selectedIndex];
        expect(layer!.probability).toBeDefined();
        expect(layer!.probability!).toBeCloseTo(expectedProb, 5);
      }
    });
  }
});
