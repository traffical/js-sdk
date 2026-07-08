/**
 * Test-vector integration + end-to-end tests (design §11.2 / §11.3).
 *
 * §11.2 — Construct a REAL @traffical/node client with an sdk-spec fixture
 * bundle as localConfig, register the provider with the real
 * @openfeature/server-sdk OpenFeatureAPI, and assert getBooleanValue /
 * getStringValue / getNumberValue for known units match the expected_*.json
 * vectors, with variant + flagMetadata populated. This makes the OpenFeature
 * wrapper a first-class member of the cross-SDK conformance guarantee — it does
 * not re-assert bucketing (the engine owns that), only faithful wrapping.
 *
 * §11.3 — E2E against a real node client with a two-layer bundle: resolve →
 * $traffical.exposure → reward inside runInRequest, capturing events via the
 * node client's eventLogger. Asserts the decision event emits, exposure fires
 * ONLY for the shown layer (the sibling stays attribution-only), the reward
 * carries a non-empty unitKey, and the decisions-without-exposures alarm fires.
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { OpenFeature } from "@openfeature/server-sdk";
import type { Client } from "@openfeature/server-sdk";
import {
  TrafficalClient,
  type ConfigBundle,
  type TrackableEvent,
  type ExposureEvent,
  type DecisionEvent,
  type TrackEvent,
} from "@traffical/node";

import { EXPOSURE_EVENT_NAME } from "@traffical/openfeature-core";
import { TrafficalServerProvider } from "./index.js";

// -----------------------------------------------------------------------------
// Fixture loading (relative path — sdk-spec is a sibling of js-sdk)
// -----------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "../../../../sdk-spec/test-vectors/fixtures");

function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;
}

interface ExpectedFile {
  bundle: string;
  testCases: Array<{
    name: string;
    context: Record<string, unknown>;
    expectedAssignments: Record<string, unknown>;
  }>;
}

const baseClientOpts = {
  orgId: "org_test",
  projectId: "proj_test",
  env: "production",
  apiKey: "traffical_sk_test",
  refreshIntervalMs: -1,
  disableCloudEvents: true,
  // Point at a loopback address so the initialize() config fetch fails fast
  // offline (the client falls back to localConfig) — no real network in tests.
  baseUrl: "http://127.0.0.1:1",
  requestTimeoutMs: 500,
};

// -----------------------------------------------------------------------------
// §11.2 — test-vector integration
// -----------------------------------------------------------------------------

describe("test-vector integration (§11.2)", () => {
  let basicClient: Client;
  let condClient: Client;

  beforeAll(async () => {
    const basicBundle = loadFixture<ConfigBundle>("bundle_basic.json");
    const condBundle = loadFixture<ConfigBundle>("bundle_conditions.json");

    const nodeBasic = new TrafficalClient({ ...baseClientOpts, localConfig: basicBundle });
    const nodeCond = new TrafficalClient({ ...baseClientOpts, localConfig: condBundle });

    await OpenFeature.setProviderAndWait("basic", new TrafficalServerProvider(nodeBasic));
    await OpenFeature.setProviderAndWait("conditions", new TrafficalServerProvider(nodeCond));

    basicClient = OpenFeature.getClient("basic");
    condClient = OpenFeature.getClient("conditions");
  });

  test("bundle_basic: string + number values match expected vectors for every unit", async () => {
    const expected = loadFixture<ExpectedFile>("expected_basic.json");
    for (const tc of expected.testCases) {
      const ctx = { targetingKey: String(tc.context.userId), ...tc.context };

      const color = await basicClient.getStringValue(
        "ui.primaryColor",
        "fallback",
        ctx
      );
      expect(color).toBe(tc.expectedAssignments["ui.primaryColor"] as string);

      const discount = await basicClient.getNumberValue("pricing.discount", -1, ctx);
      expect(discount).toBe(tc.expectedAssignments["pricing.discount"] as number);
    }
  });

  test("bundle_basic: details carry variant + traffical flagMetadata", async () => {
    const details = await basicClient.getStringDetails("ui.primaryColor", "fallback", {
      targetingKey: "user-abc",
      userId: "user-abc",
    });
    // control bucket for user-abc → an allocation variant is present.
    expect(details.variant).toBeDefined();
    expect(details.flagMetadata["traffical.decisionId"]).toBeDefined();
    expect(details.flagMetadata["traffical.layerId"]).toBe("layer_ui");
  });

  test("bundle_conditions: boolean + string values match expected vectors", async () => {
    const expected = loadFixture<ExpectedFile>("expected_conditions.json");
    for (const tc of expected.testCases) {
      const ctx = { targetingKey: String(tc.context.userId), ...tc.context };

      if ("checkout.showUrgency" in tc.expectedAssignments) {
        const urgency = await condClient.getBooleanValue(
          "checkout.showUrgency",
          false,
          ctx
        );
        expect(urgency).toBe(tc.expectedAssignments["checkout.showUrgency"] as boolean);
      }
      if ("checkout.ctaText" in tc.expectedAssignments) {
        const cta = await condClient.getStringValue("checkout.ctaText", "fallback", ctx);
        expect(cta).toBe(tc.expectedAssignments["checkout.ctaText"] as string);
      }
    }
  });
});

// -----------------------------------------------------------------------------
// §11.3 — E2E: resolve → exposure → reward, plus the alarm
// -----------------------------------------------------------------------------

/**
 * Two-layer bundle: requesting only flagA (layer_a) leaves layer_b resolved
 * attribution-only. flagO is an object flag on layer_a for getObjectValue.
 */
const twoLayerBundle: ConfigBundle = {
  version: "2026-01-01T00:00:00Z",
  orgId: "org_test",
  projectId: "proj_test",
  env: "production",
  hashing: { unitKey: "userId", bucketCount: 1000 },
  parameters: [
    { key: "flagA", type: "string", default: "a-default", layerId: "layer_a", namespace: "" },
    {
      key: "flagO",
      type: "json",
      default: { theme: "light" },
      layerId: "layer_a",
      namespace: "",
    },
    { key: "flagB", type: "string", default: "b-default", layerId: "layer_b", namespace: "" },
  ],
  layers: [
    {
      id: "layer_a",
      policies: [
        {
          id: "pol_a",
          state: "running",
          kind: "static",
          conditions: [],
          allocations: [
            {
              id: "alloc_a",
              name: "treatment",
              bucketRange: [0, 999],
              overrides: { flagA: "a-treatment", flagO: { theme: "dark" } },
            },
          ],
        },
      ],
    },
    {
      id: "layer_b",
      policies: [
        {
          id: "pol_b",
          state: "running",
          kind: "static",
          conditions: [],
          allocations: [
            {
              id: "alloc_b",
              name: "control",
              bucketRange: [0, 999],
              overrides: { flagB: "b-control" },
            },
          ],
        },
      ],
    },
  ],
} as unknown as ConfigBundle;

describe("E2E: resolve → exposure → reward (§11.3)", () => {
  test("decision + exposure(only shown layer) + reward(non-empty unitKey)", async () => {
    const events: TrackableEvent[] = [];
    const node = new TrafficalClient({
      ...baseClientOpts,
      localConfig: twoLayerBundle,
      eventLogger: (e) => events.push(e),
    });
    const provider = new TrafficalServerProvider(node);
    await OpenFeature.setProviderAndWait("e2e", provider);
    const client = OpenFeature.getClient("e2e");

    await provider.runInRequest(async () => {
      // Resolve ONLY flagA (layer_b is attribution-only).
      const details = await client.getStringDetails("flagA", "fallback", {
        targetingKey: "u1",
        userId: "u1",
      });
      expect(details.value).toBe("a-treatment");
      expect(details.variant).toBe("treatment");
      expect(details.flagMetadata["traffical.layerId"]).toBe("layer_a");

      // Explicit exposure via the reserved event name.
      client.track(EXPOSURE_EVENT_NAME, {
        targetingKey: "u1",
        // details.flagKey echoes which flag was shown
        flagKey: "flagA",
      } as never);

      // Reward.
      client.track("purchase", { targetingKey: "u1" }, { value: 42 });
    });

    const decisions = events.filter((e): e is DecisionEvent => e.type === "decision");
    const exposures = events.filter((e): e is ExposureEvent => e.type === "exposure");
    const rewards = events.filter((e): e is TrackEvent => e.type === "track");

    // Decision event emitted (ITT).
    expect(decisions.length).toBeGreaterThanOrEqual(1);

    // Exposure fired ONLY for the shown layer (layer_a / pol_a), not the
    // attribution-only sibling (pol_b).
    expect(exposures).toHaveLength(1);
    const exposedPolicyIds = exposures[0]!.layers.map((l) => l.policyId);
    expect(exposedPolicyIds).toContain("pol_a");
    expect(exposedPolicyIds).not.toContain("pol_b");

    // Reward carries a non-empty unit key and its value.
    expect(rewards).toHaveLength(1);
    expect(rewards[0]!.unitKey).toBe("u1");
    expect(rewards[0]!.value).toBe(42);

    await node.destroy();
  });

  test("object flag resolves through getObjectValue", async () => {
    const node = new TrafficalClient({ ...baseClientOpts, localConfig: twoLayerBundle });
    const provider = new TrafficalServerProvider(node);
    await OpenFeature.setProviderAndWait("e2e-obj", provider);
    const client = OpenFeature.getClient("e2e-obj");

    const value = await client.getObjectValue(
      "flagO",
      { theme: "light" },
      { targetingKey: "u1", userId: "u1" }
    );
    expect(value).toEqual({ theme: "dark" });

    await node.destroy();
  });

  test("decisions-without-exposures triggers the alarm (D2)", async () => {
    const original = console.warn;
    const warnMessages: string[] = [];
    console.warn = (...args: unknown[]) => {
      warnMessages.push(args.map((a) => String(a)).join(" "));
    };

    const node = new TrafficalClient({ ...baseClientOpts, localConfig: twoLayerBundle });
    const provider = new TrafficalServerProvider(node);
    await OpenFeature.setProviderAndWait("e2e-alarm", provider);
    const client = OpenFeature.getClient("e2e-alarm");

    const errorEvents: string[] = [];
    provider.events.addHandler("PROVIDER_ERROR" as never, (d) => {
      if (d?.message) errorEvents.push(d.message);
    });

    // Resolve many distinct units, never firing an exposure.
    await provider.runInRequest(async () => {
      for (let i = 0; i < 25; i++) {
        await client.getStringValue("flagA", "fallback", {
          targetingKey: `unit-${i}`,
          userId: `unit-${i}`,
        });
      }
    });
    await Promise.resolve();

    console.warn = original;

    expect(warnMessages.some((m) => m.includes("0 exposures"))).toBe(true);
    expect(errorEvents.some((m) => m.includes("0 exposures"))).toBe(true);

    await node.destroy();
  });
});
