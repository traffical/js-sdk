import { describe, test, expect } from "bun:test";
import { StandardResolutionReasons, TypeMismatchError, ErrorCode } from "@openfeature/core";
import type { DecisionResult, LayerResolution } from "@traffical/core";
import {
  selectOwnerLayer,
  deriveReason,
  buildFlagMetadata,
  toResolutionDetails,
} from "./translate.js";

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

/** The flag's own layer: a bucketed A/B allocation. */
const ownerLayer: LayerResolution = {
  layerId: "layer_a",
  bucket: 42,
  policyId: "pol_a",
  policyKey: "checkout_button",
  allocationId: "alloc_a",
  allocationName: "treatment",
  allocationKey: "treatment",
};

/**
 * A sibling layer the unit is ALSO bucketed into, but whose flag wasn't
 * requested — flagged attributionOnly. selectOwnerLayer must never pick this.
 */
const attributionSibling: LayerResolution = {
  layerId: "layer_b",
  bucket: 7,
  policyId: "pol_b",
  policyKey: "sibling_experiment",
  allocationId: "alloc_b",
  allocationName: "sibling_control",
  allocationKey: "sibling_control",
  attributionOnly: true,
};

/** An adaptive (bandit) owner layer carrying propensity + model version. */
const adaptiveOwnerLayer: LayerResolution = {
  layerId: "layer_c",
  bucket: 3,
  policyId: "pol_c",
  policyKey: "banner_bandit",
  allocationId: "alloc_c",
  allocationName: "variant_2",
  allocationKey: "variant_2",
  probability: 0.25,
  modelVersion: "2026-07-01T00:00:00Z",
};

/** A layer with no policy match (bucket -1, no allocation) — DEFAULT case. */
const noMatchLayer: LayerResolution = {
  layerId: "layer_a",
  bucket: -1,
};

function makeDecision(layers: LayerResolution[], assignments: Record<string, unknown>): DecisionResult {
  return {
    decisionId: "dec_123",
    assignments: assignments as DecisionResult["assignments"],
    metadata: {
      timestamp: "2026-07-08T00:00:00Z",
      unitKeyValue: "user-123",
      layers,
      configVersion: "2026-07-08T00:00:00Z",
    },
  };
}

// -----------------------------------------------------------------------------
// selectOwnerLayer
// -----------------------------------------------------------------------------

describe("selectOwnerLayer", () => {
  test("picks the layer whose layerId matches ownerLayerId", () => {
    const decision = makeDecision([attributionSibling, ownerLayer], { flagA: "treatment-val" });
    const layer = selectOwnerLayer(decision, "layer_a");
    expect(layer?.layerId).toBe("layer_a");
    expect(layer?.allocationName).toBe("treatment");
  });

  test("never picks an attributionOnly sibling even when it comes first", () => {
    const decision = makeDecision([attributionSibling, ownerLayer], { flagA: "treatment-val" });
    // by id
    expect(selectOwnerLayer(decision, "layer_b")?.attributionOnly).toBe(true);
    // by fallback (ownerLayerId null) — must skip the attributionOnly sibling
    const fallback = selectOwnerLayer(decision, null);
    expect(fallback?.layerId).toBe("layer_a");
    expect(fallback?.attributionOnly).toBeUndefined();
  });

  test("falls back to the sole non-attributionOnly layer when ownerLayerId is null", () => {
    const decision = makeDecision([ownerLayer, attributionSibling], { flagA: "x" });
    const layer = selectOwnerLayer(decision, null);
    expect(layer?.layerId).toBe("layer_a");
  });

  test("returns undefined when no matching layerId is present", () => {
    const decision = makeDecision([attributionSibling], { flagA: "x" });
    expect(selectOwnerLayer(decision, "layer_a")).toBeUndefined();
  });

  test("returns undefined when null fallback finds only attributionOnly layers", () => {
    const decision = makeDecision([attributionSibling], {});
    expect(selectOwnerLayer(decision, null)).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
// deriveReason
// -----------------------------------------------------------------------------

describe("deriveReason", () => {
  test("SPLIT when the layer has an allocationName", () => {
    expect(deriveReason(ownerLayer)).toBe(StandardResolutionReasons.SPLIT);
    expect(deriveReason(adaptiveOwnerLayer)).toBe(StandardResolutionReasons.SPLIT);
  });

  test("DEFAULT when the layer has no allocation", () => {
    expect(deriveReason(noMatchLayer)).toBe(StandardResolutionReasons.DEFAULT);
  });

  test("DEFAULT when there is no owner layer at all", () => {
    expect(deriveReason(undefined)).toBe(StandardResolutionReasons.DEFAULT);
  });
});

// -----------------------------------------------------------------------------
// buildFlagMetadata
// -----------------------------------------------------------------------------

describe("buildFlagMetadata", () => {
  test("emits scalar-only traffical.* keys with coerced string ids", () => {
    const decision = makeDecision([ownerLayer], { flagA: "treatment-val" });
    const meta = buildFlagMetadata(decision, ownerLayer);

    expect(meta["traffical.decisionId"]).toBe("dec_123");
    expect(meta["traffical.policyId"]).toBe("pol_a");
    expect(meta["traffical.policyKey"]).toBe("checkout_button");
    expect(meta["traffical.allocationId"]).toBe("alloc_a");
    expect(meta["traffical.allocationKey"]).toBe("treatment");
    expect(meta["traffical.layerId"]).toBe("layer_a");
    expect(meta["traffical.bucket"]).toBe(42);
    expect(meta["traffical.configVersion"]).toBe("2026-07-08T00:00:00Z");

    // all values are scalars
    for (const v of Object.values(meta)) {
      expect(["string", "number", "boolean"]).toContain(typeof v);
    }
  });

  test("omits bucket when it is -1 (no-bucket sentinel)", () => {
    const decision = makeDecision([noMatchLayer], {});
    const meta = buildFlagMetadata(decision, noMatchLayer);
    expect("traffical.bucket" in meta).toBe(false);
  });

  test("emits propensity + modelVersion for adaptive layers", () => {
    const decision = makeDecision([adaptiveOwnerLayer], { flagC: "v2" });
    const meta = buildFlagMetadata(decision, adaptiveOwnerLayer);
    expect(meta["traffical.propensity"]).toBe(0.25);
    expect(meta["traffical.modelVersion"]).toBe("2026-07-01T00:00:00Z");
  });

  test("omits propensity for static layers (no probability present)", () => {
    const decision = makeDecision([ownerLayer], { flagA: "x" });
    const meta = buildFlagMetadata(decision, ownerLayer);
    expect("traffical.propensity" in meta).toBe(false);
    expect("traffical.modelVersion" in meta).toBe(false);
  });

  test("gates propensity out entirely when gatePropensity is set (web)", () => {
    const decision = makeDecision([adaptiveOwnerLayer], { flagC: "v2" });
    const meta = buildFlagMetadata(decision, adaptiveOwnerLayer, { gatePropensity: true });
    expect("traffical.propensity" in meta).toBe(false);
    // modelVersion still present — only propensity is gated by this flag
    expect(meta["traffical.modelVersion"]).toBe("2026-07-01T00:00:00Z");
  });

  test("omits configVersion when absent", () => {
    const decision: DecisionResult = {
      decisionId: "dec_x",
      assignments: {},
      metadata: { timestamp: "t", unitKeyValue: "u", layers: [] },
    };
    const meta = buildFlagMetadata(decision, undefined);
    expect("traffical.configVersion" in meta).toBe(false);
    // still carries the decisionId even with no layer
    expect(meta["traffical.decisionId"]).toBe("dec_x");
  });

  test("with no owner layer, emits only decision-scoped keys", () => {
    const decision = makeDecision([], {});
    const meta = buildFlagMetadata(decision, undefined);
    expect(meta["traffical.decisionId"]).toBe("dec_123");
    expect("traffical.layerId" in meta).toBe(false);
    expect("traffical.policyId" in meta).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// toResolutionDetails
// -----------------------------------------------------------------------------

describe("toResolutionDetails", () => {
  test("translates value/variant/reason/metadata for a real allocation", () => {
    const decision = makeDecision([attributionSibling, ownerLayer], { flagA: "treatment-val" });
    const details = toResolutionDetails({
      flagKey: "flagA",
      defaultValue: "fallback",
      expectedType: "string",
      decision,
      ownerLayerId: "layer_a",
    });

    expect(details.value).toBe("treatment-val");
    expect(details.variant).toBe("treatment");
    expect(details.reason).toBe(StandardResolutionReasons.SPLIT);
    expect(details.flagMetadata?.["traffical.policyKey"]).toBe("checkout_button");
    // owning-layer selection: sibling's allocation must NOT leak in
    expect(details.variant).not.toBe("sibling_control");
    expect(details.flagMetadata?.["traffical.layerId"]).toBe("layer_a");
  });

  test("returns DEFAULT + defaultValue when the key is absent / no owner layer", () => {
    const decision = makeDecision([noMatchLayer], {});
    const details = toResolutionDetails({
      flagKey: "flagA",
      defaultValue: "the-default",
      expectedType: "string",
      decision,
      ownerLayerId: "layer_a",
    });
    expect(details.value).toBe("the-default");
    expect(details.variant).toBeUndefined();
    expect(details.reason).toBe(StandardResolutionReasons.DEFAULT);
  });

  test("boolean flag resolves and reports SPLIT", () => {
    const decision = makeDecision([ownerLayer], { flagA: true });
    const details = toResolutionDetails({
      flagKey: "flagA",
      defaultValue: false,
      expectedType: "boolean",
      decision,
      ownerLayerId: "layer_a",
    });
    expect(details.value).toBe(true);
    expect(details.reason).toBe(StandardResolutionReasons.SPLIT);
  });

  test("number flag resolves", () => {
    const decision = makeDecision([ownerLayer], { flagA: 3.14 });
    const details = toResolutionDetails({
      flagKey: "flagA",
      defaultValue: 0,
      expectedType: "number",
      decision,
      ownerLayerId: "layer_a",
    });
    expect(details.value).toBe(3.14);
  });

  test("object flag accepts a plain object", () => {
    const decision = makeDecision([ownerLayer], { flagA: { color: "blue" } });
    const details = toResolutionDetails({
      flagKey: "flagA",
      defaultValue: {},
      expectedType: "object",
      decision,
      ownerLayerId: "layer_a",
    });
    expect(details.value).toEqual({ color: "blue" });
  });

  test("object flag accepts an array", () => {
    const decision = makeDecision([ownerLayer], { flagA: [1, 2, 3] });
    const details = toResolutionDetails({
      flagKey: "flagA",
      defaultValue: [],
      expectedType: "object",
      decision,
      ownerLayerId: "layer_a",
    });
    expect(details.value).toEqual([1, 2, 3]);
  });

  test("THROWS TypeMismatchError on wrong type (no coercion to default)", () => {
    const decision = makeDecision([ownerLayer], { flagA: "not-a-number" });
    let thrown: unknown;
    try {
      toResolutionDetails({
        flagKey: "flagA",
        defaultValue: 0,
        expectedType: "number",
        decision,
        ownerLayerId: "layer_a",
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(TypeMismatchError);
    expect((thrown as TypeMismatchError).code).toBe(ErrorCode.TYPE_MISMATCH);
  });

  test("does NOT coerce truthy string to boolean — throws instead", () => {
    const decision = makeDecision([ownerLayer], { flagA: "true" });
    expect(() =>
      toResolutionDetails({
        flagKey: "flagA",
        defaultValue: false,
        expectedType: "boolean",
        decision,
        ownerLayerId: "layer_a",
      })
    ).toThrow(TypeMismatchError);
  });

  test("null is not a valid object value — throws", () => {
    const decision = makeDecision([ownerLayer], { flagA: null });
    expect(() =>
      toResolutionDetails({
        flagKey: "flagA",
        defaultValue: {},
        expectedType: "object",
        decision,
        ownerLayerId: "layer_a",
      })
    ).toThrow(TypeMismatchError);
  });

  test("uses the null-ownerLayerId fallback (sole non-attributionOnly layer)", () => {
    const decision = makeDecision([attributionSibling, ownerLayer], { flagA: "v" });
    const details = toResolutionDetails({
      flagKey: "flagA",
      defaultValue: "d",
      expectedType: "string",
      decision,
      ownerLayerId: null,
    });
    expect(details.variant).toBe("treatment");
    expect(details.flagMetadata?.["traffical.layerId"]).toBe("layer_a");
  });

  test("gatePropensity omits propensity in the resolution metadata", () => {
    const decision = makeDecision([adaptiveOwnerLayer], { flagC: "v2" });
    const details = toResolutionDetails({
      flagKey: "flagC",
      defaultValue: "d",
      expectedType: "string",
      decision,
      ownerLayerId: "layer_c",
      gatePropensity: true,
    });
    expect("traffical.propensity" in (details.flagMetadata ?? {})).toBe(false);
  });
});
