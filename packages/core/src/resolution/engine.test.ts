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
    // Bucket 551 for layer_ui (treatment: 500-999)
    // Bucket 913 for layer_pricing (no allocation: outside 0-599)
    const assignments = resolveParameters(bundle, { userId: "user-abc" }, basicDefaults);

    expect(assignments["ui.primaryColor"]).toBe("#FF0000"); // treatment (bucket 551 >= 500)
    expect(assignments["ui.buttonText"]).toBe("Click Me"); // default
    expect(assignments["pricing.discount"]).toBe(0); // no allocation (bucket 913 >= 600)
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
    // Bucket 871 for layer_ui (treatment: 500-999)
    // Bucket 177 for layer_pricing (discount_10: 0-299)
    const assignments = resolveParameters(bundle, { userId: "user-123" }, basicDefaults);

    expect(assignments["ui.primaryColor"]).toBe("#FF0000"); // treatment (bucket 871 >= 500)
    expect(assignments["ui.buttonText"]).toBe("Click Me"); // default
    expect(assignments["pricing.discount"]).toBe(10); // discount_10 (bucket 177 in 0-299)
  });

  test("returns defaults when unit key is missing", () => {
    const assignments = resolveParameters(bundle, {}, basicDefaults);

    // Should return caller defaults when unit key is missing
    expect(assignments["ui.primaryColor"]).toBe("#0000FF");
    expect(assignments["ui.buttonText"]).toBe("Click Me");
    expect(assignments["pricing.discount"]).toBe(0);
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
    expect(assignments["ui.primaryColor"]).toBe("#FF0000");
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

    // From bundle (overridden by policy) - bucket 551 = treatment
    expect(result["ui.primaryColor"]).toBe("#FF0000");
    // From caller defaults (not in bundle)
    expect(result["ui.fontSize"]).toBe(16);
  });

  test("returns caller defaults when unit key is missing", () => {
    const defaults = {
      "ui.primaryColor": "#FFFFFF",
    };

    const result = resolveParameters(bundle, {}, defaults);

    expect(result["ui.primaryColor"]).toBe("#FFFFFF");
  });
});

describe("decide", () => {
  const bundle = bundleBasic as unknown as ConfigBundle;

  test("returns decision with metadata", () => {
    const decision = decide(bundle, { userId: "user-abc" }, basicDefaults);

    expect(decision.decisionId).toMatch(/^dec_/);
    expect(decision.assignments["ui.primaryColor"]).toBe("#FF0000");
    expect(decision.metadata.unitKeyValue).toBe("user-abc");
    expect(decision.metadata.layers).toHaveLength(2);
  });

  test("includes correct layer resolution info", () => {
    const decision = decide(bundle, { userId: "user-abc" }, basicDefaults);

    const uiLayer = decision.metadata.layers.find(
      (l) => l.layerId === "layer_ui"
    );
    expect(uiLayer).toBeDefined();
    expect(uiLayer!.bucket).toBe(551);
    expect(uiLayer!.policyId).toBe("policy_color_test");
    expect(uiLayer!.allocationName).toBe("treatment");

    const pricingLayer = decision.metadata.layers.find(
      (l) => l.layerId === "layer_pricing"
    );
    expect(pricingLayer).toBeDefined();
    expect(pricingLayer!.bucket).toBe(913);
    // No allocation matched (bucket 913 is outside all ranges 0-599)
    expect(pricingLayer!.policyId).toBeUndefined();
  });

  test("returns defaults with empty metadata when bundle is null", () => {
    const decision = decide(null, { userId: "user-abc" }, basicDefaults);

    expect(decision.decisionId).toMatch(/^dec_/);
    expect(decision.assignments["ui.primaryColor"]).toBe("#0000FF");
    expect(decision.metadata.unitKeyValue).toBe("");
    expect(decision.metadata.layers).toHaveLength(0);
  });

  test("returns defaults with empty metadata when unit key is missing", () => {
    const decision = decide(bundle, {}, basicDefaults);

    expect(decision.decisionId).toMatch(/^dec_/);
    expect(decision.assignments["ui.primaryColor"]).toBe("#0000FF");
    expect(decision.metadata.unitKeyValue).toBe("");
    expect(decision.metadata.layers).toHaveLength(0);
  });
});
