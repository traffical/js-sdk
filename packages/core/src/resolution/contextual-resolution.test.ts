/**
 * Contextual Resolution Integration Tests
 *
 * Validates end-to-end contextual bandit scoring using test vector fixtures.
 */

import { describe, test, expect } from "bun:test";
import { resolveParameters, decide } from "./engine.js";
import type { ConfigBundle } from "../types/index.js";

import { bundleContextual, expectedContextual } from "@traffical/sdk-spec";

const bundle = bundleContextual as unknown as ConfigBundle;
const testCases = expectedContextual.testCases;

const defaults = {
  "ui.heroVariant": "default",
};

describe("contextual scoring resolution", () => {
  for (const tc of testCases) {
    test(`resolveParameters: ${tc.name}`, () => {
      const assignments = resolveParameters(bundle, tc.context, defaults);
      for (const [key, expected] of Object.entries(tc.expectedAssignments)) {
        expect(assignments[key]).toBe(expected);
      }
    });

    test(`decide: ${tc.name}`, () => {
      const decision = decide(bundle, tc.context, defaults);

      for (const [key, expected] of Object.entries(tc.expectedAssignments)) {
        expect(decision.assignments[key]).toBe(expected);
      }

      // Verify the correct allocation was selected
      const heroLayer = decision.metadata.layers.find(
        (l) => l.layerId === "layer_hero"
      );
      expect(heroLayer).toBeDefined();
      expect(heroLayer!.policyId).toBe("policy_contextual");
      expect(heroLayer!.allocationName).toBe(tc.expectedAllocation);
    });
  }

  test("decide includes filteredContext with allowed fields", () => {
    const decision = decide(
      bundle,
      { userId: "user-high-engage", engagement_score: 8.0, device_type: "mobile", secretField: "pii" },
      defaults
    );

    expect(decision.metadata.filteredContext).toBeDefined();
    expect(decision.metadata.filteredContext!.engagement_score).toBe(8.0);
    expect(decision.metadata.filteredContext!.device_type).toBe("mobile");
    expect(decision.metadata.filteredContext!.secretField).toBeUndefined();
  });

  test("falls back to bucket-based when contextualModel is absent", () => {
    // Create a copy of the bundle without contextualModel
    const bundleWithoutModel = JSON.parse(JSON.stringify(bundle)) as ConfigBundle;
    for (const layer of bundleWithoutModel.layers) {
      for (const policy of layer.policies) {
        delete (policy as Record<string, unknown>).contextualModel;
      }
    }

    // Should now use standard bucket-based resolution
    const decision = decide(
      bundleWithoutModel,
      { userId: "user-high-engage", engagement_score: 8.0, device_type: "mobile" },
      defaults
    );

    // The allocation should be determined by the bucket, not the model scores.
    // We just verify a valid allocation was selected (bucket-based, not contextual).
    const heroLayer = decision.metadata.layers.find(
      (l) => l.layerId === "layer_hero"
    );
    expect(heroLayer).toBeDefined();
    expect(heroLayer!.policyId).toBe("policy_contextual");
    expect(heroLayer!.allocationName).toBeDefined();
    // The exact allocation depends on the bucket hash, but it must be one of the three
    expect(["control", "treatment_a", "treatment_b"]).toContain(
      heroLayer!.allocationName
    );
  });

  test("returns defaults when unit key is missing", () => {
    const assignments = resolveParameters(bundle, { engagement_score: 5.0 }, defaults);
    expect(assignments["ui.heroVariant"]).toBe("default");
  });
});
