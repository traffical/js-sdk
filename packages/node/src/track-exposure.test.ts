/**
 * Tests for the Node SDK exposure path (enh #3 — parity with the browser SDK):
 * - trackExposure() skips `attributionOnly` layers (experiments the user was
 *   assigned to for attribution but not actually shown).
 * - trackExposure() deduplicates per (unit, policy, allocation) within a session.
 * - getUnitKeyField() / getParameterLayerId() read the loaded bundle.
 *
 * Uses a two-layer bundle where every unit matches a policy in both layers.
 * Requesting only `flagA` (layer_a) leaves layer_b resolved attribution-only.
 */

import { describe, test, expect } from "bun:test";
import type { ConfigBundle, ExposureEvent, TrackableEvent } from "@traffical/core";
import { TrafficalClient } from "./client.js";

const bundle: ConfigBundle = {
  version: "2026-01-01T00:00:00Z",
  orgId: "org_1",
  projectId: "proj_1",
  env: "production",
  hashing: { unitKey: "userId", bucketCount: 1000 },
  parameters: [
    { key: "flagA", type: "string", default: "a-default", layerId: "layer_a", namespace: "" },
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
            { id: "alloc_a", name: "treatment", bucketRange: [0, 999], overrides: { flagA: "a-treatment" } },
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
            { id: "alloc_b", name: "control", bucketRange: [0, 999], overrides: { flagB: "b-control" } },
          ],
        },
      ],
    },
  ],
};

const baseOpts = {
  orgId: "org_1",
  projectId: "proj_1",
  env: "production",
  apiKey: "traffical_sk_test",
  refreshIntervalMs: -1,
  trackDecisions: false, // keep captured events to exposures only
  disableCloudEvents: true,
  localConfig: bundle,
};

describe("Node bundle accessors", () => {
  test("getUnitKeyField / getParameterLayerId read from the bundle", () => {
    const client = new TrafficalClient(baseOpts);
    expect(client.getUnitKeyField()).toBe("userId");
    expect(client.getParameterLayerId("flagA")).toBe("layer_a");
    expect(client.getParameterLayerId("flagB")).toBe("layer_b");
    expect(client.getParameterLayerId("nope")).toBeNull();
  });
});

describe("Node trackExposure", () => {
  test("skips attribution-only layers", async () => {
    const events: TrackableEvent[] = [];
    const client = new TrafficalClient({ ...baseOpts, eventLogger: (e) => events.push(e) });

    // Request only flagA → layer_b resolves attribution-only.
    const decision = client.decide({ context: { userId: "u1" }, defaults: { flagA: "x" } });
    // sanity: the decision saw layer_b as attribution-only
    expect(decision.metadata.layers.some((l) => l.attributionOnly)).toBe(true);

    client.trackExposure(decision);

    const exposures = events.filter((e): e is ExposureEvent => e.type === "exposure");
    expect(exposures).toHaveLength(1);
    const policyIds = exposures[0]!.layers.map((l) => l.policyId);
    expect(policyIds).toContain("pol_a"); // shown
    expect(policyIds).not.toContain("pol_b"); // attribution-only → skipped

    await client.destroy();
  });

  test("deduplicates repeated exposures for the same unit+policy+allocation", async () => {
    const events: TrackableEvent[] = [];
    const client = new TrafficalClient({ ...baseOpts, eventLogger: (e) => events.push(e) });

    const decision = client.decide({ context: { userId: "u1" }, defaults: { flagA: "x" } });
    client.trackExposure(decision);
    client.trackExposure(decision); // duplicate → no second exposure event

    expect(events.filter((e) => e.type === "exposure")).toHaveLength(1);

    await client.destroy();
  });

  test("deduplicateExposures: false emits every exposure", async () => {
    const events: TrackableEvent[] = [];
    const client = new TrafficalClient({
      ...baseOpts,
      deduplicateExposures: false,
      eventLogger: (e) => events.push(e),
    });

    const decision = client.decide({ context: { userId: "u1" }, defaults: { flagA: "x" } });
    client.trackExposure(decision);
    client.trackExposure(decision);

    expect(events.filter((e) => e.type === "exposure")).toHaveLength(2);

    await client.destroy();
  });
});
