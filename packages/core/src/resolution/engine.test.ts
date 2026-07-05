/**
 * Resolution Engine Tests
 *
 * Validates parameter resolution using test vectors.
 */

import { describe, test, expect } from "bun:test";
import { resolveParameters, decide } from "./engine.js";
import type { ConfigBundle } from "../types/index.js";

// Load test fixtures from @traffical/sdk-spec
import { bundleBasic, bundleConditions } from "@traffical/sdk-spec";

// Default values for basic bundle parameters
const basicDefaults = {
  "ui.primaryColor": "#0000FF",
  "ui.buttonText": "Click Me",
  "pricing.discount": 0,
};

// Default values for conditions bundle parameters
const conditionsDefaults = {
  "checkout.ctaText": "Complete Purchase",
  "checkout.showUrgency": false,
};

describe("resolveParameters", () => {
  const bundle = bundleBasic as unknown as ConfigBundle;

  test("resolves user-abc correctly", () => {
    // Bucket 177 for layer_ui (control: 0-499)
    // Bucket 902 for layer_pricing (no allocation: outside 0-599)
    const assignments = resolveParameters(bundle, { userId: "user-abc" }, basicDefaults);

    expect(assignments["ui.primaryColor"]).toBe("#0000FF"); // control (bucket 177 < 500)
    expect(assignments["ui.buttonText"]).toBe("Click Me"); // default
    expect(assignments["pricing.discount"]).toBe(0); // no allocation (bucket 902 >= 600)
  });

  test("resolves user-xyz correctly", () => {
    // Bucket 214 for layer_ui (control: 0-499)
    // Bucket 42 for layer_pricing (discount_10: 0-299)
    const assignments = resolveParameters(bundle, { userId: "user-xyz" }, basicDefaults);

    expect(assignments["ui.primaryColor"]).toBe("#0000FF"); // control (bucket 214 < 500)
    expect(assignments["ui.buttonText"]).toBe("Click Me"); // default
    expect(assignments["pricing.discount"]).toBe(10); // discount_10 (bucket 42 in 0-299)
  });

  test("resolves user-123 correctly", () => {
    // Bucket 480 for layer_ui (control: 0-499)
    // Bucket 738 for layer_pricing (no allocation: outside 0-599)
    const assignments = resolveParameters(bundle, { userId: "user-123" }, basicDefaults);

    expect(assignments["ui.primaryColor"]).toBe("#0000FF"); // control (bucket 480 < 500)
    expect(assignments["ui.buttonText"]).toBe("Click Me"); // default
    expect(assignments["pricing.discount"]).toBe(0); // no allocation (bucket 738 >= 600)
  });

  test("falls back to bundle param defaults when unit key is missing", () => {
    // Multi-entity diversion-types change: the engine no longer bails
    // out when the project-level unit key is missing — some layers may
    // still resolve via a layer-level `unitKey` override. With no unit
    // key resolvable for any layer here, every layer is skipped with
    // `bucket = -1`, so no allocation overrides apply. Bundle parameter
    // defaults are surfaced instead of caller defaults so the user sees
    // the publisher-intended baseline.
    const assignments = resolveParameters(bundle, {}, basicDefaults);

    expect(assignments["ui.primaryColor"]).toBe("#000000"); // bundle default
    expect(assignments["ui.buttonText"]).toBe("Click Me"); // bundle default
    expect(assignments["pricing.discount"]).toBe(0); // bundle default
  });

  test("returns defaults when bundle is null", () => {
    const assignments = resolveParameters(null, { userId: "user-abc" }, basicDefaults);

    expect(assignments["ui.primaryColor"]).toBe("#0000FF");
    expect(assignments["ui.buttonText"]).toBe("Click Me");
    expect(assignments["pricing.discount"]).toBe(0);
  });

  test("only resolves requested parameters from defaults", () => {
    const partialDefaults = {
      "ui.primaryColor": "#FFFFFF",
    };
    const assignments = resolveParameters(bundle, { userId: "user-abc" }, partialDefaults);

    expect(Object.keys(assignments)).toEqual(["ui.primaryColor"]);
    expect(assignments["ui.primaryColor"]).toBe("#0000FF");
  });
});

describe("resolveParameters with conditions", () => {
  const bundle = bundleConditions as unknown as ConfigBundle;

  test("high value cart triggers urgency", () => {
    const assignments = resolveParameters(
      bundle,
      {
        userId: "user-high-value",
        cartValue: 150,
        deviceType: "desktop",
      },
      conditionsDefaults
    );

    expect(assignments["checkout.ctaText"]).toBe("Buy Now - Limited Stock!");
    expect(assignments["checkout.showUrgency"]).toBe(true);
  });

  test("mobile user with low cart gets mobile CTA", () => {
    const assignments = resolveParameters(
      bundle,
      {
        userId: "user-mobile",
        cartValue: 50,
        deviceType: "mobile",
      },
      conditionsDefaults
    );

    expect(assignments["checkout.ctaText"]).toBe("Buy Now");
    expect(assignments["checkout.showUrgency"]).toBe(false);
  });

  test("desktop user with low cart gets defaults", () => {
    const assignments = resolveParameters(
      bundle,
      {
        userId: "user-desktop",
        cartValue: 50,
        deviceType: "desktop",
      },
      conditionsDefaults
    );

    expect(assignments["checkout.ctaText"]).toBe("Complete Purchase");
    expect(assignments["checkout.showUrgency"]).toBe(false);
  });

  test("high value cart takes precedence over mobile", () => {
    const assignments = resolveParameters(
      bundle,
      {
        userId: "user-mobile-high",
        cartValue: 200,
        deviceType: "mobile",
      },
      conditionsDefaults
    );

    expect(assignments["checkout.ctaText"]).toBe("Buy Now - Limited Stock!");
    expect(assignments["checkout.showUrgency"]).toBe(true);
  });
});

describe("resolveParameters graceful degradation", () => {
  const bundle = bundleBasic as unknown as ConfigBundle;

  test("returns defaults when bundle is null", () => {
    const defaults = {
      "ui.primaryColor": "#FFFFFF",
      "ui.fontSize": 16,
    };

    const result = resolveParameters(null, { userId: "user-abc" }, defaults);

    expect(result["ui.primaryColor"]).toBe("#FFFFFF");
    expect(result["ui.fontSize"]).toBe(16);
  });

  test("merges bundle values with caller defaults", () => {
    const defaults = {
      "ui.primaryColor": "#FFFFFF",
      "ui.fontSize": 16,
    };

    const result = resolveParameters(bundle, { userId: "user-abc" }, defaults);

    // From bundle (overridden by policy) - bucket 177 = control
    expect(result["ui.primaryColor"]).toBe("#0000FF");
    // From caller defaults (not in bundle)
    expect(result["ui.fontSize"]).toBe(16);
  });

  test("falls back to bundle param defaults when unit key is missing", () => {
    // See per-layer unit key change: with no project unit key and no
    // layer-level override resolvable, every layer is skipped and
    // bundle parameter defaults win over caller defaults for keys the
    // bundle knows about.
    const defaults = {
      "ui.primaryColor": "#FFFFFF",
    };

    const result = resolveParameters(bundle, {}, defaults);

    expect(result["ui.primaryColor"]).toBe("#000000"); // bundle default
  });
});

describe("decide", () => {
  const bundle = bundleBasic as unknown as ConfigBundle;

  test("returns decision with metadata", () => {
    const decision = decide(bundle, { userId: "user-abc" }, basicDefaults);

    expect(decision.decisionId).toMatch(/^dec_/);
    expect(decision.assignments["ui.primaryColor"]).toBe("#0000FF");
    expect(decision.metadata.unitKeyValue).toBe("user-abc");
    expect(decision.metadata.layers).toHaveLength(2);
  });

  test("includes correct layer resolution info", () => {
    const decision = decide(bundle, { userId: "user-abc" }, basicDefaults);

    const uiLayer = decision.metadata.layers.find(
      (l) => l.layerId === "layer_ui"
    );
    expect(uiLayer).toBeDefined();
    expect(uiLayer!.bucket).toBe(177);
    expect(uiLayer!.policyId).toBe("policy_color_test");
    expect(uiLayer!.allocationName).toBe("control");

    const pricingLayer = decision.metadata.layers.find(
      (l) => l.layerId === "layer_pricing"
    );
    expect(pricingLayer).toBeDefined();
    expect(pricingLayer!.bucket).toBe(902);
    // No allocation matched (bucket 902 is outside all ranges 0-599)
    expect(pricingLayer!.policyId).toBeUndefined();
  });

  test("returns defaults with empty metadata when bundle is null", () => {
    const decision = decide(null, { userId: "user-abc" }, basicDefaults);

    expect(decision.decisionId).toMatch(/^dec_/);
    expect(decision.assignments["ui.primaryColor"]).toBe("#0000FF");
    expect(decision.metadata.unitKeyValue).toBe("");
    expect(decision.metadata.layers).toHaveLength(0);
  });

  test("emits skipped layer metadata when unit key is missing", () => {
    // See diversion-types change: the engine no longer short-circuits on
    // a missing project unit key. It records each layer with
    // `bucket = -1` so decision events still describe what would have
    // been considered, and bundle param defaults are returned.
    const decision = decide(bundle, {}, basicDefaults);

    expect(decision.decisionId).toMatch(/^dec_/);
    expect(decision.assignments["ui.primaryColor"]).toBe("#000000");
    expect(decision.metadata.unitKeyValue).toBe("");
    expect(decision.metadata.layers).toHaveLength(2);
    for (const layer of decision.metadata.layers) {
      expect(layer.bucket).toBe(-1);
    }
  });
});

// =============================================================================
// Attribution-only layers (decoupled attribution from parameter resolution)
// =============================================================================

describe("decide - attribution-only layers", () => {
  const bundle = bundleBasic as unknown as ConfigBundle;

  test("layers with matching params are NOT marked attributionOnly", () => {
    const decision = decide(bundle, { userId: "user-abc" }, basicDefaults);

    // Both layers have matching params in basicDefaults
    for (const layer of decision.metadata.layers) {
      expect(layer.attributionOnly).toBeUndefined();
    }
  });

  test("layers without matching params ARE marked attributionOnly", () => {
    // Only request ui.primaryColor — layer_ui has params, layer_pricing does not
    const decision = decide(bundle, { userId: "user-abc" }, {
      "ui.primaryColor": "#FFFFFF",
    });

    expect(decision.metadata.layers).toHaveLength(2);

    const uiLayer = decision.metadata.layers.find(
      (l) => l.layerId === "layer_ui"
    );
    expect(uiLayer).toBeDefined();
    expect(uiLayer!.attributionOnly).toBeUndefined(); // has matching params
    expect(uiLayer!.policyId).toBe("policy_color_test");
    expect(uiLayer!.allocationName).toBe("control");

    const pricingLayer = decision.metadata.layers.find(
      (l) => l.layerId === "layer_pricing"
    );
    expect(pricingLayer).toBeDefined();
    expect(pricingLayer!.attributionOnly).toBe(true); // no matching params
    // Still resolved for attribution: bucket computed, policy matched
    expect(pricingLayer!.bucket).toBe(902);
  });

  test("empty defaults produces all layers as attributionOnly", () => {
    const decision = decide(bundle, { userId: "user-abc" }, {});

    expect(decision.metadata.layers).toHaveLength(2);

    for (const layer of decision.metadata.layers) {
      expect(layer.attributionOnly).toBe(true);
    }

    // Verify bucket computation and policy matching still happened
    const uiLayer = decision.metadata.layers.find(
      (l) => l.layerId === "layer_ui"
    );
    expect(uiLayer!.bucket).toBe(177);
    expect(uiLayer!.policyId).toBe("policy_color_test");
    expect(uiLayer!.allocationName).toBe("control");
  });

  test("empty defaults does NOT modify assignments", () => {
    const decision = decide(bundle, { userId: "user-abc" }, {});

    // Assignments should be the empty defaults — no overrides applied
    expect(Object.keys(decision.assignments)).toHaveLength(0);
  });

  test("attribution-only layers do not apply parameter overrides", () => {
    // Request only ui params. pricing layer should NOT apply overrides
    // even though user-xyz has bucket 141 which matches discount_10.
    const decision = decide(bundle, { userId: "user-xyz" }, {
      "ui.primaryColor": "#FFFFFF",
    });

    // Only ui.primaryColor should be in assignments
    expect(Object.keys(decision.assignments)).toEqual(["ui.primaryColor"]);
    // pricing.discount should NOT appear in assignments
    expect(decision.assignments["pricing.discount"]).toBeUndefined();

    // But pricing layer is still resolved for attribution
    const pricingLayer = decision.metadata.layers.find(
      (l) => l.layerId === "layer_pricing"
    );
    expect(pricingLayer!.attributionOnly).toBe(true);
    expect(pricingLayer!.bucket).toBe(141);
    expect(pricingLayer!.policyId).toBe("policy_discount");
    expect(pricingLayer!.allocationName).toBe("discount_10");
  });

  test("decisionId is generated even with empty defaults", () => {
    const decision = decide(bundle, { userId: "user-abc" }, {});

    expect(decision.decisionId).toMatch(/^dec_/);
    expect(decision.metadata.unitKeyValue).toBe("user-abc");
    expect(decision.metadata.timestamp).toBeDefined();
  });

  test("requesting params from one layer does not affect the other", () => {
    // Request only pricing params
    const decision = decide(bundle, { userId: "user-xyz" }, {
      "pricing.discount": 0,
    });

    expect(decision.metadata.layers).toHaveLength(2);

    const uiLayer = decision.metadata.layers.find(
      (l) => l.layerId === "layer_ui"
    );
    expect(uiLayer!.attributionOnly).toBe(true);
    // Still resolved: bucket + policy matching happened
    expect(uiLayer!.bucket).toBe(443);
    expect(uiLayer!.policyId).toBe("policy_color_test");
    expect(uiLayer!.allocationName).toBe("control");

    const pricingLayer = decision.metadata.layers.find(
      (l) => l.layerId === "layer_pricing"
    );
    expect(pricingLayer!.attributionOnly).toBeUndefined(); // has matching params
    expect(pricingLayer!.policyId).toBe("policy_discount");
    expect(pricingLayer!.allocationName).toBe("discount_10");

    // Only pricing.discount in assignments (with override applied)
    expect(decision.assignments["pricing.discount"]).toBe(10);
    expect(decision.assignments["ui.primaryColor"]).toBeUndefined();
  });
});

// =============================================================================
// Per-layer unit key (multi-entity randomization)
// =============================================================================
//
// Covers the diversion-types change: each layer can carry its own
// `unitKey` that overrides `bundle.hashing.unitKey`. Layers whose unit
// key is missing in context are skipped (bucket -1, no overrides),
// while sibling layers continue to resolve.
//
// We construct the bundle inline to avoid baking new fixtures into
// `@traffical/sdk-spec` for this incremental field.
describe("decide - per-layer unit key", () => {
  function buildMixedUnitBundle(): ConfigBundle {
    return {
      version: "2024-01-01T00:00:00.000Z",
      orgId: "org_test",
      projectId: "proj_test",
      env: "production",
      hashing: { unitKey: "userId", bucketCount: 1000 },
      parameters: [
        {
          key: "ui.primaryColor",
          type: "string",
          default: "#000000",
          layerId: "layer_ui",
          namespace: "ui",
        },
        {
          key: "pricing.discount",
          type: "number",
          default: 0,
          layerId: "layer_pricing",
          namespace: "pricing",
        },
      ],
      layers: [
        {
          id: "layer_ui",
          policies: [
            {
              id: "policy_color_test",
              state: "running",
              kind: "static",
              allocations: [
                {
                  name: "control",
                  bucketRange: [0, 499],
                  overrides: { "ui.primaryColor": "#0000FF" },
                },
                {
                  name: "treatment",
                  bucketRange: [500, 999],
                  overrides: { "ui.primaryColor": "#FF0000" },
                },
              ],
              conditions: [],
            },
          ],
        },
        {
          // Merchant-scoped layer in a customer-primary project. The
          // SDK should hash on context.merchantId for this layer only.
          id: "layer_pricing",
          unitKey: "merchantId",
          policies: [
            {
              id: "policy_discount",
              state: "running",
              kind: "static",
              allocations: [
                {
                  name: "discount_10",
                  bucketRange: [0, 999],
                  overrides: { "pricing.discount": 10 },
                },
              ],
              conditions: [],
            },
          ],
        },
      ],
    } as unknown as ConfigBundle;
  }

  const defaults = {
    "ui.primaryColor": "#000000",
    "pricing.discount": 0,
  };

  test("uses bundle.hashing.unitKey for layers without override", () => {
    const bundle = buildMixedUnitBundle();
    const decision = decide(
      bundle,
      { userId: "user-abc", merchantId: "merchant-1" },
      defaults
    );

    const uiLayer = decision.metadata.layers.find((l) => l.layerId === "layer_ui");
    expect(uiLayer).toBeDefined();
    // No layer-level override → no unitKey/unitKeyValue surfaced for the
    // ui layer.
    expect(uiLayer!.unitKey).toBeUndefined();
    expect(uiLayer!.unitKeyValue).toBeUndefined();
  });

  test("uses layer.unitKey override and surfaces it in LayerResolution", () => {
    const bundle = buildMixedUnitBundle();
    const decision = decide(
      bundle,
      { userId: "user-abc", merchantId: "merchant-1" },
      defaults
    );

    const pricingLayer = decision.metadata.layers.find(
      (l) => l.layerId === "layer_pricing"
    );
    expect(pricingLayer).toBeDefined();
    expect(pricingLayer!.unitKey).toBe("merchantId");
    expect(pricingLayer!.unitKeyValue).toBe("merchant-1");
    // Allocation covers all buckets so we always get the override.
    expect(decision.assignments["pricing.discount"]).toBe(10);
  });

  test("skips a layer whose unitKey is missing from context", () => {
    const bundle = buildMixedUnitBundle();
    // Only userId provided — the merchant-scoped layer should be
    // skipped, while the customer-scoped layer still resolves.
    const decision = decide(bundle, { userId: "user-abc" }, defaults);

    const uiLayer = decision.metadata.layers.find((l) => l.layerId === "layer_ui");
    const pricingLayer = decision.metadata.layers.find(
      (l) => l.layerId === "layer_pricing"
    );

    // ui layer still resolves on userId (engine.ts already covered by
    // the existing test suite — we assert it didn't regress).
    expect(uiLayer).toBeDefined();
    expect(uiLayer!.bucket).toBeGreaterThanOrEqual(0);

    // pricing layer is skipped: no bucket assignment, no override.
    expect(pricingLayer).toBeDefined();
    expect(pricingLayer!.bucket).toBe(-1);
    expect(decision.assignments["pricing.discount"]).toBe(0);
  });
});

// =============================================================================
// Propensity (probability) metadata
// =============================================================================
//
// Adaptive policies record the propensity of the CHOSEN allocation at
// decision time in `LayerResolution.probability` for off-policy training:
// - bucket-based adaptive: the allocation's bucket-range share
// - per-entity (bundle mode): the entity weight the SDK actually used
// - static: omitted (fixed split, not a propensity)
//
// We construct bundles inline to avoid baking new fixtures into
// `@traffical/sdk-spec` for this incremental field.
describe("decide - propensity (probability) metadata", () => {
  function buildPropensityBundle(): ConfigBundle {
    return {
      version: "2024-01-01T00:00:00.000Z",
      orgId: "org_test",
      projectId: "proj_test",
      env: "production",
      hashing: { unitKey: "userId", bucketCount: 1000 },
      parameters: [
        {
          key: "ui.primaryColor",
          type: "string",
          default: "#000000",
          layerId: "layer_static",
          namespace: "ui",
        },
        {
          key: "pricing.discount",
          type: "number",
          default: 0,
          layerId: "layer_adaptive",
          namespace: "pricing",
        },
      ],
      layers: [
        {
          id: "layer_static",
          policies: [
            {
              id: "policy_static",
              state: "running",
              kind: "static",
              allocations: [
                {
                  name: "control",
                  bucketRange: [0, 499],
                  overrides: { "ui.primaryColor": "#0000FF" },
                },
                {
                  name: "treatment",
                  bucketRange: [500, 999],
                  overrides: { "ui.primaryColor": "#FF0000" },
                },
              ],
              conditions: [],
            },
          ],
        },
        {
          id: "layer_adaptive",
          policies: [
            {
              id: "policy_bandit",
              state: "running",
              kind: "adaptive",
              allocations: [
                {
                  name: "discount_10",
                  bucketRange: [0, 249],
                  overrides: { "pricing.discount": 10 },
                },
                {
                  name: "discount_20",
                  bucketRange: [250, 999],
                  overrides: { "pricing.discount": 20 },
                },
              ],
              conditions: [],
            },
          ],
        },
      ],
    } as unknown as ConfigBundle;
  }

  const defaults = {
    "ui.primaryColor": "#000000",
    "pricing.discount": 0,
  };

  test("static policies omit probability", () => {
    const decision = decide(buildPropensityBundle(), { userId: "user-abc" }, defaults);

    const staticLayer = decision.metadata.layers.find(
      (l) => l.layerId === "layer_static"
    );
    expect(staticLayer).toBeDefined();
    expect(staticLayer!.policyId).toBe("policy_static");
    expect(staticLayer!.probability).toBeUndefined();
    expect(staticLayer!.modelVersion).toBeUndefined();
  });

  test("adaptive bucket-based policies record the bucket-range share", () => {
    const bundle = buildPropensityBundle();
    const decision = decide(bundle, { userId: "user-abc" }, defaults);

    const adaptiveLayer = decision.metadata.layers.find(
      (l) => l.layerId === "layer_adaptive"
    );
    expect(adaptiveLayer).toBeDefined();
    expect(adaptiveLayer!.policyId).toBe("policy_bandit");
    expect(adaptiveLayer!.probability).toBeDefined();

    // The propensity must equal the CHOSEN allocation's bucket-range share.
    const chosen = (bundle.layers[1].policies[0].allocations).find(
      (a) => a.name === adaptiveLayer!.allocationName
    )!;
    const share = (chosen.bucketRange[1] - chosen.bucketRange[0] + 1) / 1000;
    expect(adaptiveLayer!.probability!).toBeCloseTo(share, 10);
    expect([0.25, 0.75]).toContain(adaptiveLayer!.probability!);
    // Not a contextual selection — no model version.
    expect(adaptiveLayer!.modelVersion).toBeUndefined();
  });

  test("per-entity bundle-mode policies record the entity weight actually used", () => {
    const bundle: ConfigBundle = {
      version: "2024-01-01T00:00:00.000Z",
      orgId: "org_test",
      projectId: "proj_test",
      env: "production",
      hashing: { unitKey: "userId", bucketCount: 1000 },
      parameters: [
        {
          key: "pricing.discount",
          type: "number",
          default: 0,
          layerId: "layer_entity",
          namespace: "pricing",
        },
      ],
      layers: [
        {
          id: "layer_entity",
          policies: [
            {
              id: "policy_entity",
              state: "running",
              kind: "adaptive",
              allocations: [
                {
                  id: "alloc_a",
                  name: "variant_a",
                  bucketRange: [0, 499],
                  overrides: { "pricing.discount": 10 },
                },
                {
                  id: "alloc_b",
                  name: "variant_b",
                  bucketRange: [500, 999],
                  overrides: { "pricing.discount": 20 },
                },
              ],
              conditions: [],
              entityConfig: {
                entityKeys: ["productId"],
                resolutionMode: "bundle",
              },
            },
          ],
        },
      ],
      entityState: {
        policy_entity: {
          _global: {
            entityId: "_global",
            weights: [0.5, 0.5],
            computedAt: "2024-01-01T00:00:00.000Z",
          },
          entities: {
            "prod-42": {
              entityId: "prod-42",
              weights: [0.9, 0.1],
              computedAt: "2024-01-01T00:00:00.000Z",
            },
          },
        },
      },
    } as unknown as ConfigBundle;

    const decision = decide(
      bundle,
      { userId: "user-1", productId: "prod-42" },
      { "pricing.discount": 0 }
    );

    const entityLayer = decision.metadata.layers.find(
      (l) => l.layerId === "layer_entity"
    );
    expect(entityLayer).toBeDefined();
    expect(entityLayer!.policyId).toBe("policy_entity");
    expect(entityLayer!.probability).toBeDefined();
    // The propensity is the weight the SDK actually used for the chosen
    // allocation from the entity's learned weights [0.9, 0.1].
    const chosenWeight = entityLayer!.allocationName === "variant_a" ? 0.9 : 0.1;
    expect(entityLayer!.probability!).toBeCloseTo(chosenWeight, 10);

    // Unknown entity falls back to the global prior weights [0.5, 0.5].
    const coldDecision = decide(
      bundle,
      { userId: "user-1", productId: "prod-unknown" },
      { "pricing.discount": 0 }
    );
    const coldLayer = coldDecision.metadata.layers.find(
      (l) => l.layerId === "layer_entity"
    );
    expect(coldLayer!.probability!).toBeCloseTo(0.5, 10);
  });
});

// =============================================================================
// Probability bounds guard
// =============================================================================
//
// The events schema requires probability in (0, 1] (exclusiveMinimum 0,
// maximum 1). Out-of-range values are OMITTED — never clamped, never emitted
// as 0 or >1.
describe("decide - probability bounds guard", () => {
  test("omits probability when the bucket-range share exceeds 1 (inconsistent bucketCount)", () => {
    // bucketCount 100 but the allocation spans 1000 buckets — the computed
    // share would be 10, which must be omitted rather than emitted raw.
    const bundle = {
      version: "2024-01-01T00:00:00.000Z",
      orgId: "org_test",
      projectId: "proj_test",
      env: "production",
      hashing: { unitKey: "userId", bucketCount: 100 },
      parameters: [
        {
          key: "pricing.discount",
          type: "number",
          default: 0,
          layerId: "layer_adaptive",
          namespace: "pricing",
        },
      ],
      layers: [
        {
          id: "layer_adaptive",
          policies: [
            {
              id: "policy_bandit",
              state: "running",
              kind: "adaptive",
              allocations: [
                {
                  name: "discount_10",
                  bucketRange: [0, 999],
                  overrides: { "pricing.discount": 10 },
                },
              ],
              conditions: [],
            },
          ],
        },
      ],
    } as unknown as ConfigBundle;

    const decision = decide(bundle, { userId: "user-abc" }, { "pricing.discount": 0 });
    const layer = decision.metadata.layers.find((l) => l.layerId === "layer_adaptive");

    expect(layer).toBeDefined();
    expect(layer!.policyId).toBe("policy_bandit");
    // The selection still happened, but the out-of-range propensity is omitted.
    expect(layer!.allocationName).toBe("discount_10");
    expect(layer!.probability).toBeUndefined();
  });

  test("omits probability for degenerate zero-weight per-entity selections", () => {
    // All-zero entity weights: weightedSelection falls back to the last
    // index, whose weight (0) is not a valid propensity and must be omitted.
    const bundle = {
      version: "2024-01-01T00:00:00.000Z",
      orgId: "org_test",
      projectId: "proj_test",
      env: "production",
      hashing: { unitKey: "userId", bucketCount: 1000 },
      parameters: [
        {
          key: "pricing.discount",
          type: "number",
          default: 0,
          layerId: "layer_entity",
          namespace: "pricing",
        },
      ],
      layers: [
        {
          id: "layer_entity",
          policies: [
            {
              id: "policy_entity",
              state: "running",
              kind: "adaptive",
              allocations: [
                {
                  id: "alloc_a",
                  name: "variant_a",
                  bucketRange: [0, 499],
                  overrides: { "pricing.discount": 10 },
                },
                {
                  id: "alloc_b",
                  name: "variant_b",
                  bucketRange: [500, 999],
                  overrides: { "pricing.discount": 20 },
                },
              ],
              conditions: [],
              entityConfig: {
                entityKeys: ["productId"],
                resolutionMode: "bundle",
              },
            },
          ],
        },
      ],
      entityState: {
        policy_entity: {
          entities: {
            "prod-degenerate": {
              entityId: "prod-degenerate",
              weights: [0, 0],
              computedAt: "2024-01-01T00:00:00.000Z",
            },
          },
        },
      },
    } as unknown as ConfigBundle;

    const decision = decide(
      bundle,
      { userId: "user-1", productId: "prod-degenerate" },
      { "pricing.discount": 0 }
    );
    const layer = decision.metadata.layers.find((l) => l.layerId === "layer_entity");

    expect(layer).toBeDefined();
    expect(layer!.policyId).toBe("policy_entity");
    // A selection was made (fallback), but its zero weight is not a valid
    // propensity in (0, 1] and must be omitted.
    expect(layer!.allocationName).toBeDefined();
    expect(layer!.probability).toBeUndefined();
  });
});

// =============================================================================
// configVersion snapshot
// =============================================================================
//
// The config bundle version is captured AT DECISION TIME into the decision
// metadata; decision/exposure events are stamped from that snapshot so a
// background config refresh between decide() and the event build can't
// misattribute the decision to a newer version.
describe("decide - configVersion snapshot", () => {
  const bundle = bundleBasic as unknown as ConfigBundle;

  test("stamps the bundle version into decision metadata", () => {
    const decision = decide(bundle, { userId: "user-abc" }, basicDefaults);
    expect(decision.metadata.configVersion).toBe(bundle.version);
  });

  test("omits configVersion on cold start (no bundle)", () => {
    const decision = decide(null, { userId: "user-abc" }, basicDefaults);
    expect(decision.metadata.configVersion).toBeUndefined();
  });
});
