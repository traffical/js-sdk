/**
 * Edge Results Tests
 *
 * Tests for ResolveOptions.edgeResults in the resolution engine.
 * Validates that pre-fetched edge results are correctly applied.
 */

import { describe, test, expect } from "bun:test";
import { resolveParameters, decide } from "./engine.js";
import type { ConfigBundle } from "../types/index.js";
import type { ResolveOptions } from "./engine.js";

// =============================================================================
// Test Bundle Builders
// =============================================================================

function createBundleWithEdgePolicy(opts?: {
  dynamicAllocations?: boolean;
  mixStandard?: boolean;
}): ConfigBundle {
  const layers: ConfigBundle["layers"] = [];

  if (opts?.mixStandard) {
    layers.push({
      id: "layer_standard",
      policies: [
        {
          id: "policy_standard",
          state: "running",
          kind: "static",
          allocations: [
            {
              id: "alloc_control",
              name: "control",
              bucketRange: [0, 499] as [number, number],
              overrides: { "ui.color": "#000" },
            },
            {
              id: "alloc_treatment",
              name: "treatment",
              bucketRange: [500, 999] as [number, number],
              overrides: { "ui.color": "#F00" },
            },
          ],
          conditions: [],
        },
      ],
    });
  }

  if (opts?.dynamicAllocations) {
    layers.push({
      id: "layer_edge_dynamic",
      policies: [
        {
          id: "policy_edge_dynamic",
          state: "running",
          kind: "adaptive",
          allocations: [],
          conditions: [],
          entityConfig: {
            entityKeys: ["productId"],
            resolutionMode: "edge" as const,
            dynamicAllocations: { countKey: "numVariants" },
          },
        },
      ],
    });
  } else {
    layers.push({
      id: "layer_edge",
      policies: [
        {
          id: "policy_edge",
          state: "running",
          kind: "adaptive",
          allocations: [
            {
              id: "alloc_a",
              name: "variant_a",
              bucketRange: [0, 499] as [number, number],
              overrides: { "pricing.discount": 10 },
            },
            {
              id: "alloc_b",
              name: "variant_b",
              bucketRange: [500, 999] as [number, number],
              overrides: { "pricing.discount": 20 },
            },
          ],
          conditions: [],
          entityConfig: {
            entityKeys: ["productId"],
            resolutionMode: "edge" as const,
          },
        },
      ],
    });
  }

  return {
    version: "2024-01-01T00:00:00Z",
    orgId: "org_test",
    projectId: "proj_test",
    env: "test",
    hashing: { unitKey: "userId", bucketCount: 1000 },
    parameters: [
      ...(opts?.mixStandard
        ? [{ key: "ui.color", type: "string" as const, default: "#FFF", layerId: "layer_standard", namespace: "ui" }]
        : []),
      ...(opts?.dynamicAllocations
        ? [{ key: "selected.index", type: "number" as const, default: -1, layerId: "layer_edge_dynamic", namespace: "selected" }]
        : [{ key: "pricing.discount", type: "number" as const, default: 0, layerId: "layer_edge", namespace: "pricing" }]),
    ],
    layers,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("resolveInternal with edgeResults", () => {
  test("applies fixed-allocation edge result overrides", () => {
    const bundle = createBundleWithEdgePolicy();
    const context = { userId: "user-1", productId: "prod-42" };
    const defaults = { "pricing.discount": 0 };

    const edgeResults = new Map([
      ["policy_edge", { allocationIndex: 1, entityId: "prod-42" }],
    ]);
    const options: ResolveOptions = { edgeResults };

    const result = resolveParameters(bundle, context, defaults, options);
    expect(result["pricing.discount"]).toBe(20);
  });

  test("applies fixed-allocation edge result (index 0)", () => {
    const bundle = createBundleWithEdgePolicy();
    const context = { userId: "user-1", productId: "prod-42" };
    const defaults = { "pricing.discount": 0 };

    const edgeResults = new Map([
      ["policy_edge", { allocationIndex: 0, entityId: "prod-42" }],
    ]);

    const result = resolveParameters(bundle, context, defaults, { edgeResults });
    expect(result["pricing.discount"]).toBe(10);
  });

  test("dynamic-allocation edge result returns allocation name in metadata", () => {
    const bundle = createBundleWithEdgePolicy({ dynamicAllocations: true });
    const context = { userId: "user-1", productId: "prod-42", numVariants: 5 };
    const defaults = { "selected.index": -1 };

    const edgeResults = new Map([
      ["policy_edge_dynamic", { allocationIndex: 3, entityId: "prod-42" }],
    ]);

    const decision = decide(bundle, context, defaults, { edgeResults });
    const edgeLayer = decision.metadata.layers.find(
      (l) => l.layerId === "layer_edge_dynamic"
    );

    expect(edgeLayer).toBeDefined();
    expect(edgeLayer!.policyId).toBe("policy_edge_dynamic");
    expect(edgeLayer!.allocationName).toBe("3");
  });

  test("missing edge result gracefully skips the policy", () => {
    const bundle = createBundleWithEdgePolicy();
    const context = { userId: "user-1", productId: "prod-42" };
    const defaults = { "pricing.discount": 0 };

    // Empty edgeResults map — no result for policy_edge
    const edgeResults = new Map<string, { allocationIndex: number; entityId: string }>();

    const result = resolveParameters(bundle, context, defaults, { edgeResults });
    // Should fall back to bundle default since edge policy is skipped
    expect(result["pricing.discount"]).toBe(0);
  });

  test("mixed bundle: standard + edge policies resolve correctly", () => {
    const bundle = createBundleWithEdgePolicy({ mixStandard: true });
    const context = { userId: "user-abc", productId: "prod-42" };
    const defaults = { "ui.color": "#FFF", "pricing.discount": 0 };

    const edgeResults = new Map([
      ["policy_edge", { allocationIndex: 0, entityId: "prod-42" }],
    ]);

    const result = resolveParameters(bundle, context, defaults, { edgeResults });

    // Standard policy resolves via bucket as normal
    // Edge policy resolves via edgeResults
    expect(result["pricing.discount"]).toBe(10);
    // ui.color should resolve to either control or treatment based on bucket
    expect(["#000", "#F00"]).toContain(result["ui.color"]);
  });

  test("backward compat: resolveParameters without options works", () => {
    const bundle = createBundleWithEdgePolicy();
    const context = { userId: "user-1", productId: "prod-42" };
    const defaults = { "pricing.discount": 0 };

    // No options — should work fine, edge policy just skipped
    const result = resolveParameters(bundle, context, defaults);
    expect(result["pricing.discount"]).toBe(0);
  });

  test("backward compat: decide without options works", () => {
    const bundle = createBundleWithEdgePolicy();
    const context = { userId: "user-1", productId: "prod-42" };
    const defaults = { "pricing.discount": 0 };

    const decision = decide(bundle, context, defaults);
    expect(decision.decisionId).toBeDefined();
    expect(decision.assignments["pricing.discount"]).toBe(0);
  });
});
