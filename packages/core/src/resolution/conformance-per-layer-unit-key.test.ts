/**
 * Per-Layer Unit Key Conformance Tests
 *
 * Validates that decide() correctly resolves layers with per-layer unitKey
 * overrides using the sdk-spec fixtures. Each layer may hash on a different
 * context field; layers whose unit key is missing from context are skipped
 * with bucket = -1.
 */

import { describe, test, expect } from "bun:test";
import { resolveParameters, decide } from "./engine.js";
import type { ConfigBundle, ParameterValue } from "../types/index.js";
import {
  bundlePerLayerUnitKey,
  expectedPerLayerUnitKey,
} from "@traffical/sdk-spec";

const bundle = bundlePerLayerUnitKey as unknown as ConfigBundle;

const defaults: Record<string, ParameterValue> = {
  "ui.theme": "light",
  "pricing.merchantDiscount": 0,
};

describe("per-layer unit key conformance (sdk-spec fixtures)", () => {
  for (const tc of expectedPerLayerUnitKey.testCases) {
    test(tc.name, () => {
      const decision = decide(bundle, tc.context, defaults);

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

      const expectedLayers = tc.expectedLayers.map((l) => {
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
      const params = resolveParameters(bundle, tc.context, defaults);
      expect(params).toEqual(tc.expectedAssignments);
    });
  }
});
