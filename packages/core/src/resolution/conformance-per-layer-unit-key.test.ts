/**
 * Per-Layer Unit Key Conformance Tests
 *
 * Validates that decide() correctly resolves layers with per-layer unitKey
 * overrides using the sdk-spec fixtures. Each layer may hash on a different
 * context field; layers whose unit key is missing from context are skipped
 * with bucket = -1.
 *
 * Fixtures are inlined from sdk-spec/test-vectors/fixtures/ so CI doesn't
 * depend on a not-yet-published sdk-spec version. Once sdk-spec >=0.4.0 is
 * published, these can switch to `import { ... } from "@traffical/sdk-spec"`.
 */

import { describe, test, expect } from "bun:test";
import { resolveParameters, decide } from "./engine.js";
import type { ConfigBundle, ParameterValue } from "../types/index.js";

// Inline fixtures — mirrors bundle_per_layer_unit_key.json
const bundlePerLayerUnitKey = {
  version: "2024-01-01T00:00:00.000Z",
  orgId: "org_test",
  projectId: "proj_test",
  env: "production",
  hashing: { unitKey: "userId", bucketCount: 1000 },
  parameters: [
    { key: "ui.theme", type: "string", default: "light", layerId: "layer_user_ui", namespace: "ui" },
    { key: "pricing.merchantDiscount", type: "number", default: 0, layerId: "layer_merchant_pricing", namespace: "pricing" },
  ],
  layers: [
    {
      id: "layer_user_ui",
      policies: [{
        id: "policy_ui_theme", state: "running", kind: "static",
        allocations: [
          { name: "control", bucketRange: [0, 499], overrides: { "ui.theme": "light" } },
          { name: "dark_mode", bucketRange: [500, 999], overrides: { "ui.theme": "dark" } },
        ],
        conditions: [],
      }],
    },
    {
      id: "layer_merchant_pricing",
      unitKey: "merchantId",
      policies: [{
        id: "policy_merchant_discount", state: "running", kind: "static",
        allocations: [
          { name: "no_discount", bucketRange: [0, 499], overrides: { "pricing.merchantDiscount": 0 } },
          { name: "discount_15", bucketRange: [500, 999], overrides: { "pricing.merchantDiscount": 15 } },
        ],
        conditions: [],
      }],
    },
  ],
} as unknown as ConfigBundle;

// Inline fixtures — mirrors expected_per_layer_unit_key.json
const expectedPerLayerUnitKey = {
  testCases: [
    {
      name: "both_keys_present",
      context: { userId: "user-abc", merchantId: "merchant-1" },
      expectedHashing: {
        layer_user_ui: { bucket: 641 },
        layer_merchant_pricing: { bucket: 764 },
      },
      expectedAssignments: { "ui.theme": "dark", "pricing.merchantDiscount": 15 },
      expectedLayers: [
        { layerId: "layer_user_ui", bucket: 641, policyId: "policy_ui_theme", allocationName: "dark_mode" },
        { layerId: "layer_merchant_pricing", bucket: 764, policyId: "policy_merchant_discount", allocationName: "discount_15", unitKey: "merchantId", unitKeyValue: "merchant-1" },
      ],
    },
    {
      name: "different_merchant_different_bucket",
      context: { userId: "user-xyz", merchantId: "merchant-42" },
      expectedHashing: {
        layer_user_ui: { bucket: 872 },
        layer_merchant_pricing: { bucket: 542 },
      },
      expectedAssignments: { "ui.theme": "dark", "pricing.merchantDiscount": 15 },
      expectedLayers: [
        { layerId: "layer_user_ui", bucket: 872, policyId: "policy_ui_theme", allocationName: "dark_mode" },
        { layerId: "layer_merchant_pricing", bucket: 542, policyId: "policy_merchant_discount", allocationName: "discount_15", unitKey: "merchantId", unitKeyValue: "merchant-42" },
      ],
    },
    {
      name: "merchant_key_missing",
      context: { userId: "user-abc" },
      expectedHashing: {
        layer_user_ui: { bucket: 641 },
        layer_merchant_pricing: { bucket: -1 },
      },
      expectedAssignments: { "ui.theme": "dark", "pricing.merchantDiscount": 0 },
      expectedLayers: [
        { layerId: "layer_user_ui", bucket: 641, policyId: "policy_ui_theme", allocationName: "dark_mode" },
        { layerId: "layer_merchant_pricing", bucket: -1, unitKey: "merchantId", unitKeyValue: "" },
      ],
    },
    {
      name: "project_unit_key_missing",
      context: { merchantId: "merchant-1" },
      expectedHashing: {
        layer_user_ui: { bucket: -1 },
        layer_merchant_pricing: { bucket: 764 },
      },
      expectedAssignments: { "ui.theme": "light", "pricing.merchantDiscount": 15 },
      expectedLayers: [
        { layerId: "layer_user_ui", bucket: -1 },
        { layerId: "layer_merchant_pricing", bucket: 764, policyId: "policy_merchant_discount", allocationName: "discount_15", unitKey: "merchantId", unitKeyValue: "merchant-1" },
      ],
    },
    {
      name: "both_keys_missing",
      context: {},
      expectedHashing: {
        layer_user_ui: { bucket: -1 },
        layer_merchant_pricing: { bucket: -1 },
      },
      expectedAssignments: { "ui.theme": "light", "pricing.merchantDiscount": 0 },
      expectedLayers: [
        { layerId: "layer_user_ui", bucket: -1 },
        { layerId: "layer_merchant_pricing", bucket: -1, unitKey: "merchantId", unitKeyValue: "" },
      ],
    },
  ],
};

const defaults: Record<string, ParameterValue> = {
  "ui.theme": "light",
  "pricing.merchantDiscount": 0,
};

describe("per-layer unit key conformance (sdk-spec fixtures)", () => {
  for (const tc of expectedPerLayerUnitKey.testCases) {
    test(tc.name, () => {
      const decision = decide(bundlePerLayerUnitKey, tc.context, defaults);

      expect(decision.assignments).toEqual(tc.expectedAssignments);

      for (const [layerId, expected] of Object.entries(tc.expectedHashing)) {
        const actual = decision.metadata.layers.find(
          (l) => l.layerId === layerId
        );
        expect(actual).toBeDefined();
        expect(actual!.bucket).toBe(expected.bucket);
      }

      const actualLayers = decision.metadata.layers.map((l) => {
        const entry: Record<string, unknown> = {
          layerId: l.layerId,
          bucket: l.bucket,
        };
        if (l.policyId !== undefined) entry.policyId = l.policyId;
        if (l.allocationName !== undefined) entry.allocationName = l.allocationName;
        if (l.unitKey !== undefined) entry.unitKey = l.unitKey;
        if (l.unitKeyValue !== undefined) entry.unitKeyValue = l.unitKeyValue;
        return entry;
      });

      const expectedLayers = tc.expectedLayers.map((l: Record<string, unknown>) => {
        const entry: Record<string, unknown> = {
          layerId: l.layerId,
          bucket: l.bucket,
        };
        if (l.policyId !== undefined) entry.policyId = l.policyId;
        if (l.allocationName !== undefined) entry.allocationName = l.allocationName;
        if (l.unitKey !== undefined) entry.unitKey = l.unitKey;
        if (l.unitKeyValue !== undefined) entry.unitKeyValue = l.unitKeyValue;
        return entry;
      });

      expect(actualLayers).toEqual(expectedLayers);
    });
  }
});

describe("per-layer unit key conformance - resolveParameters consistency", () => {
  for (const tc of expectedPerLayerUnitKey.testCases) {
    test(`${tc.name} - resolveParameters matches decide assignments`, () => {
      const params = resolveParameters(bundlePerLayerUnitKey, tc.context, defaults);
      expect(params).toEqual(tc.expectedAssignments);
    });
  }
});
