/**
 * Edge Policy Conformance Tests
 *
 * Validates that decide() produces correct results when given pre-computed
 * edgeResults from the sdk-spec fixtures. This is the Layer 1 guarantee:
 * "given correct inputs, decide() produces correct outputs."
 */

import { describe, test, expect } from "bun:test";
import { resolveParameters, decide } from "./engine.js";
import type { ConfigBundle, ParameterValue } from "../types/index.js";
import type { ResolveOptions } from "./engine.js";
import {
  bundleEdgePolicies,
  expectedEdgePolicies,
} from "@traffical/sdk-spec";

const bundle = bundleEdgePolicies as unknown as ConfigBundle;

describe("edge policy conformance (sdk-spec fixtures)", () => {
  for (const tc of expectedEdgePolicies.testCases) {
    test(tc.name, () => {
      const edgeResults = new Map(
        tc.edgeResults.map((e) => [
          e.policyId,
          { allocationIndex: e.allocationIndex, entityId: e.entityId },
        ])
      );
      const options: ResolveOptions = edgeResults.size > 0
        ? { edgeResults }
        : undefined as unknown as ResolveOptions;

      const defaults = tc.defaults as Record<string, ParameterValue>;
      const decision = decide(bundle, tc.context, defaults, options);

      expect(decision.assignments).toEqual(tc.expectedAssignments);

      const actualLayers = decision.metadata.layers.map((l) => {
        const entry: Record<string, unknown> = {
          layerId: l.layerId,
          bucket: l.bucket,
        };
        if (l.policyId !== undefined) entry.policyId = l.policyId;
        if (l.allocationId !== undefined) entry.allocationId = l.allocationId;
        if (l.allocationName !== undefined) entry.allocationName = l.allocationName;
        if (l.attributionOnly !== undefined) entry.attributionOnly = l.attributionOnly;
        return entry;
      });

      expect(actualLayers).toEqual(tc.expectedLayers);
    });
  }
});

describe("edge policy conformance - resolveParameters consistency", () => {
  for (const tc of expectedEdgePolicies.testCases) {
    test(`${tc.name} - resolveParameters matches decide assignments`, () => {
      const edgeResults = new Map(
        tc.edgeResults.map((e) => [
          e.policyId,
          { allocationIndex: e.allocationIndex, entityId: e.entityId },
        ])
      );
      const options: ResolveOptions = edgeResults.size > 0
        ? { edgeResults }
        : undefined as unknown as ResolveOptions;

      const defaults = tc.defaults as Record<string, ParameterValue>;
      const params = resolveParameters(bundle, tc.context, defaults, options);

      expect(params).toEqual(tc.expectedAssignments);
    });
  }
});
