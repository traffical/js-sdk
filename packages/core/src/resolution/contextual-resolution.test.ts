/**
 * Contextual Resolution Integration Tests
 *
 * Validates end-to-end contextual bandit scoring using test vector fixtures.
 */

import { describe, test, expect } from "bun:test";
import { resolveParameters, decide } from "./engine.js";
import { softmaxProbabilities, applyProbabilityFloor } from "../scoring/contextual.js";
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

    test(`decide records propensity of the chosen allocation: ${tc.name}`, () => {
      const decision = decide(bundle, tc.context, defaults);
      const heroLayer = decision.metadata.layers.find(
        (l) => l.layerId === "layer_hero"
      );
      expect(heroLayer).toBeDefined();

      // Recompute the floored-softmax distribution from the fixture's
      // expected raw scores; the layer entry must carry the probability
      // of the chosen allocation from that same distribution.
      const model = bundle.layers[0].policies[0].contextualModel!;
      const probs = softmaxProbabilities(tc.expectedScoring.scores, model.gamma);
      const floored = applyProbabilityFloor(probs, model.actionProbabilityFloor);
      const chosenIndex = bundle.layers[0].policies[0].allocations.findIndex(
        (a) => a.name === tc.expectedAllocation
      );

      expect(heroLayer!.probability).toBeDefined();
      expect(heroLayer!.probability!).toBeCloseTo(floored[chosenIndex], 10);
    });
  }

  test("S7: modelVersion is OMITTED (no stateVersion fallback) when both model timestamps are absent", () => {
    // The fixture bundle carries neither generatedAt nor modelVersion. Even
    // with a policy stateVersion present, spec 0.7.0 S7 forbids falling back
    // to it — the SDK must omit modelVersion rather than emit a wrong label.
    const bundleWithStateVersion = JSON.parse(JSON.stringify(bundle)) as ConfigBundle;
    bundleWithStateVersion.layers[0].policies[0].stateVersion = "2024-06-15T12:00:00.000Z";

    const decision = decide(
      bundleWithStateVersion,
      { userId: "user-high-engage", engagement_score: 8.0, device_type: "mobile" },
      defaults
    );

    const heroLayer = decision.metadata.layers.find((l) => l.layerId === "layer_hero");
    expect(heroLayer!.policyId).toBe("policy_contextual");
    expect(heroLayer!.modelVersion).toBeUndefined();
  });

  test("S7: modelVersion falls back to the contextualModel.modelVersion alias (never stateVersion)", () => {
    const bundleWithAlias = JSON.parse(JSON.stringify(bundle)) as ConfigBundle;
    // stateVersion present but must be ignored; the alias is the only fallback.
    bundleWithAlias.layers[0].policies[0].stateVersion = "2024-06-15T12:00:00.000Z";
    bundleWithAlias.layers[0].policies[0].contextualModel!.modelVersion =
      "2024-06-18T00:00:00.000Z";

    const decision = decide(
      bundleWithAlias,
      { userId: "user-high-engage", engagement_score: 8.0, device_type: "mobile" },
      defaults
    );

    const heroLayer = decision.metadata.layers.find((l) => l.layerId === "layer_hero");
    expect(heroLayer!.modelVersion).toBe("2024-06-18T00:00:00.000Z");
  });

  test("decide prefers the contextual model's generatedAt as modelVersion", () => {
    const bundleWithGeneratedAt = JSON.parse(JSON.stringify(bundle)) as ConfigBundle;
    bundleWithGeneratedAt.layers[0].policies[0].stateVersion = "2024-06-15T12:00:00.000Z";
    bundleWithGeneratedAt.layers[0].policies[0].contextualModel!.generatedAt =
      "2024-06-20T08:30:00.000Z";
    // The alias must lose to the canonical generatedAt.
    bundleWithGeneratedAt.layers[0].policies[0].contextualModel!.modelVersion =
      "2024-06-18T00:00:00.000Z";

    const decision = decide(
      bundleWithGeneratedAt,
      { userId: "user-high-engage", engagement_score: 8.0, device_type: "mobile" },
      defaults
    );

    const heroLayer = decision.metadata.layers.find((l) => l.layerId === "layer_hero");
    expect(heroLayer!.modelVersion).toBe("2024-06-20T08:30:00.000Z");
  });

  test("decide falls back to the contextual model's modelVersion alias when generatedAt is absent", () => {
    const bundleWithAlias = JSON.parse(JSON.stringify(bundle)) as ConfigBundle;
    bundleWithAlias.layers[0].policies[0].stateVersion = "2024-06-15T12:00:00.000Z";
    bundleWithAlias.layers[0].policies[0].contextualModel!.modelVersion =
      "2024-06-18T00:00:00.000Z";

    const decision = decide(
      bundleWithAlias,
      { userId: "user-high-engage", engagement_score: 8.0, device_type: "mobile" },
      defaults
    );

    // The alias wins over the policy stateVersion.
    const heroLayer = decision.metadata.layers.find((l) => l.layerId === "layer_hero");
    expect(heroLayer!.modelVersion).toBe("2024-06-18T00:00:00.000Z");
  });

  test("modelVersion is omitted when neither generatedAt nor stateVersion is present", () => {
    const decision = decide(
      bundle,
      { userId: "user-high-engage", engagement_score: 8.0, device_type: "mobile" },
      defaults
    );

    const heroLayer = decision.metadata.layers.find((l) => l.layerId === "layer_hero");
    expect(heroLayer!.modelVersion).toBeUndefined();
    // But the propensity is still recorded
    expect(heroLayer!.probability).toBeDefined();
  });

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

    // Still an adaptive policy: the propensity is the chosen allocation's
    // bucket-range share, and no contextual modelVersion is recorded.
    const chosen = bundleWithoutModel.layers[0].policies[0].allocations.find(
      (a) => a.name === heroLayer!.allocationName
    )!;
    const share = (chosen.bucketRange[1] - chosen.bucketRange[0] + 1) / 1000;
    expect(heroLayer!.probability).toBeCloseTo(share, 10);
    expect(heroLayer!.modelVersion).toBeUndefined();
  });

  test("returns defaults when unit key is missing", () => {
    const assignments = resolveParameters(bundle, { engagement_score: 5.0 }, defaults);
    expect(assignments["ui.heroVariant"]).toBe("default");
  });
});
