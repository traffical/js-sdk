/**
 * @traffical/svelte - Unit Tests
 *
 * Tests for the Svelte 5 SDK hooks and utilities.
 */

import { describe, test, expect } from "bun:test";
import { resolveParameters } from "@traffical/core";
import type { ConfigBundle } from "@traffical/core";

// =============================================================================
// Test Fixtures
// =============================================================================

const mockBundle: ConfigBundle = {
  version: new Date().toISOString(),
  orgId: "org_test",
  projectId: "proj_test",
  env: "test",
  hashing: {
    unitKey: "userId",
    bucketCount: 10000,
  },
  parameters: [
    {
      key: "checkout.ctaText",
      type: "string",
      default: "Buy Now",
      layerId: "layer_1",
      namespace: "checkout",
    },
    {
      key: "checkout.ctaColor",
      type: "string",
      default: "#000000",
      layerId: "layer_1",
      namespace: "checkout",
    },
    {
      key: "feature.newCheckout",
      type: "boolean",
      default: false,
      layerId: "layer_2",
      namespace: "feature",
    },
  ],
  layers: [
    {
      id: "layer_1",
      policies: [],
    },
    {
      id: "layer_2",
      policies: [],
    },
  ],
  domBindings: [],
};

const mockBundleWithLayer: ConfigBundle = {
  ...mockBundle,
  layers: [
    {
      id: "layer_1",
      policies: [
        {
          id: "policy_1",
          state: "running",
          kind: "static",
          conditions: [],
          allocations: [
            {
              id: "alloc_1",
              name: "control",
              bucketRange: [0, 4999] as [number, number],
              overrides: {
                "checkout.ctaText": "Buy Now",
                "checkout.ctaColor": "#000000",
              },
            },
            {
              id: "alloc_2",
              name: "treatment",
              bucketRange: [5000, 9999] as [number, number],
              overrides: {
                "checkout.ctaText": "Purchase",
                "checkout.ctaColor": "#FF0000",
              },
            },
          ],
        },
      ],
    },
    {
      id: "layer_2",
      policies: [],
    },
  ],
};

// =============================================================================
// Resolution Tests
// =============================================================================

describe("resolveParameters", () => {
  test("returns defaults when bundle is null", () => {
    const defaults = {
      "checkout.ctaText": "Default Text",
      "checkout.ctaColor": "#FFFFFF",
    };

    const result = resolveParameters(null, {}, defaults);
    expect(result).toEqual(defaults);
  });

  test("resolves parameters from bundle defaults", () => {
    const defaults = {
      "checkout.ctaText": "Fallback",
      "checkout.ctaColor": "#FFFFFF",
    };

    const result = resolveParameters(mockBundle, { userId: "user_123" }, defaults);

    expect(result["checkout.ctaText"]).toBe("Buy Now");
    expect(result["checkout.ctaColor"]).toBe("#000000");
  });

  test("returns defaults for missing parameters", () => {
    const defaults = {
      "checkout.ctaText": "Fallback",
      "nonexistent.param": "Default Value",
    };

    const result = resolveParameters(mockBundle, { userId: "user_123" }, defaults);

    expect(result["checkout.ctaText"]).toBe("Buy Now");
    expect(result["nonexistent.param"]).toBe("Default Value");
  });

  test("resolves boolean parameters correctly", () => {
    const defaults = {
      "feature.newCheckout": true, // Default to true, bundle has false
    };

    const result = resolveParameters(mockBundle, { userId: "user_123" }, defaults);

    expect(result["feature.newCheckout"]).toBe(false);
  });
});

// =============================================================================
// SSR Behavior Tests
// =============================================================================

describe("SSR behavior", () => {
  test("isBrowser returns false in test environment", () => {
    // In Bun test environment, window is not defined
    const isBrowser =
      typeof window !== "undefined" && typeof document !== "undefined";
    expect(isBrowser).toBe(false);
  });

  test("resolveParameters works without browser APIs", () => {
    // This verifies that core resolution doesn't depend on browser APIs
    const defaults = {
      "checkout.ctaText": "Fallback",
    };

    const result = resolveParameters(mockBundle, { userId: "ssr_user" }, defaults);

    expect(result["checkout.ctaText"]).toBe("Buy Now");
  });
});

// =============================================================================
// Type Safety Tests
// =============================================================================

describe("type safety", () => {
  test("preserves type inference for defaults", () => {
    const defaults = {
      stringParam: "hello",
      numberParam: 42,
      booleanParam: true,
    } as const;

    type Defaults = typeof defaults;

    // Type check - this should compile
    const result: Defaults = resolveParameters(
      mockBundle,
      {},
      defaults
    ) as Defaults;

    expect(typeof result.stringParam).toBe("string");
    expect(typeof result.numberParam).toBe("number");
    expect(typeof result.booleanParam).toBe("boolean");
  });
});

// =============================================================================
// Bundle Validation Tests
// =============================================================================

describe("bundle structure", () => {
  test("mock bundle has expected structure", () => {
    expect(mockBundle.orgId).toBe("org_test");
    expect(mockBundle.hashing.unitKey).toBe("userId");
    expect(mockBundle.hashing.bucketCount).toBe(10000);
    expect(mockBundle.parameters).toHaveLength(3);
    expect(mockBundle.layers).toHaveLength(2);
  });

  test("mock bundle with layer has allocations", () => {
    expect(mockBundleWithLayer.layers).toHaveLength(2);
    expect(mockBundleWithLayer.layers[0].policies).toHaveLength(1);
    expect(mockBundleWithLayer.layers[0].policies[0].allocations).toHaveLength(2);
  });
});

