/**
 * BYO Event Logger Tests (JS Client)
 *
 * Verifies the BYO `eventLogger` receives decision/exposure/track events and
 * still fires when `disableCloudEvents` is true — including decision events,
 * which requires the decision-tracking plugin to register even when cloud
 * events are disabled.
 */

import { describe, test, expect, afterEach, mock } from "bun:test";
import type { AssignmentLogEntry, ConfigBundle, TrackableEvent } from "@traffical/core";
import { TrafficalClient } from "./client.js";

const originalFetch = globalThis.fetch;

const serverResolveResponse = {
  decisionId: "dec_server_1",
  assignments: { "ui.color": "#F00" },
  metadata: {
    timestamp: "2024-01-01T00:00:00Z",
    unitKeyValue: "user-1",
    layers: [
      {
        layerId: "layer_1",
        bucket: 500,
        policyId: "pol_1",
        allocationId: "alloc_1",
        allocationName: "treatment",
      },
    ],
  },
  stateVersion: "2024-01-01T00:00:00Z",
  suggestedRefreshMs: 30000,
};

function setupFetchMock() {
  const fetchMock = mock(async () => {
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => serverResolveResponse,
      headers: new Headers({ ETag: '"v1"' }),
    } as unknown as Response;
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const clientOpts = {
  orgId: "org_test",
  projectId: "proj_test",
  env: "production",
  apiKey: "traffical_sk_test",
  refreshIntervalMs: -1,
  evaluationMode: "server" as const,
  disableCloudEvents: true,
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("JS Client eventLogger", () => {
  test("decision events reach the eventLogger even with disableCloudEvents", async () => {
    setupFetchMock();
    const events: TrackableEvent[] = [];

    const client = new TrafficalClient({
      ...clientOpts,
      // trackDecisions defaults to true
      eventLogger: (event) => events.push(event),
    });
    await client.initialize();

    client.decide({ context: { userId: "user-1" }, defaults: { "ui.color": "#000" } });

    expect(events.some((e) => e.type === "decision")).toBe(true);

    await client.destroy();
  });

  test("exposure and track events reach the eventLogger", async () => {
    setupFetchMock();
    const events: TrackableEvent[] = [];

    const client = new TrafficalClient({
      ...clientOpts,
      eventLogger: (event) => events.push(event),
    });
    await client.initialize();

    const decision = client.decide({
      context: { userId: "user-1" },
      defaults: { "ui.color": "#000" },
    });
    client.trackExposure(decision);
    client.track("add_to_cart", { value: 5 });

    expect(events.some((e) => e.type === "exposure")).toBe(true);
    const trackEvents = events.filter((e) => e.type === "track");
    expect(trackEvents).toHaveLength(1);
    expect(trackEvents[0]).toMatchObject({ event: "add_to_cart" });

    await client.destroy();
  });

  test("decision and exposure events carry configVersion (server mode: stateVersion)", async () => {
    setupFetchMock();
    const events: TrackableEvent[] = [];

    const client = new TrafficalClient({
      ...clientOpts,
      eventLogger: (event) => events.push(event),
    });
    await client.initialize();

    const decision = client.decide({
      context: { userId: "user-1" },
      defaults: { "ui.color": "#000" },
    });
    client.trackExposure(decision);

    const decisionEvent = events.find((e) => e.type === "decision");
    const exposureEvent = events.find((e) => e.type === "exposure");
    expect(decisionEvent).toBeDefined();
    expect(exposureEvent).toBeDefined();
    expect((decisionEvent as { configVersion?: string }).configVersion).toBe(
      serverResolveResponse.stateVersion
    );
    expect((exposureEvent as { configVersion?: string }).configVersion).toBe(
      serverResolveResponse.stateVersion
    );

    await client.destroy();
  });
});

// =============================================================================
// Bundle mode: configVersion + propensity in emitted events
// =============================================================================

const adaptiveBundle: ConfigBundle = {
  version: "2024-05-01T00:00:00.000Z",
  orgId: "org_test",
  projectId: "proj_test",
  env: "production",
  hashing: { unitKey: "userId", bucketCount: 1000 },
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
              id: "alloc_low",
              name: "discount_10",
              bucketRange: [0, 249],
              overrides: { "pricing.discount": 10 },
            },
            {
              id: "alloc_high",
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
};

describe("JS Client bundle mode event stamping", () => {
  test("exposure events carry configVersion and per-layer probability", async () => {
    const events: TrackableEvent[] = [];

    const client = new TrafficalClient({
      orgId: "org_test",
      projectId: "proj_test",
      env: "production",
      apiKey: "traffical_sk_test",
      refreshIntervalMs: -1,
      disableCloudEvents: true,
      localConfig: adaptiveBundle,
      eventLogger: (event) => events.push(event),
    });
    // No initialize() — resolve from localConfig only (no fetch needed).

    const decision = client.decide({
      context: { userId: "user-1" },
      defaults: { "pricing.discount": 0 },
    });
    client.trackExposure(decision);

    const exposureEvent = events.find((e) => e.type === "exposure") as
      | (TrackableEvent & { configVersion?: string; layers: Array<{ probability?: number }> })
      | undefined;
    expect(exposureEvent).toBeDefined();

    // configVersion is the bundle version the SDK evaluated against.
    expect(exposureEvent!.configVersion).toBe(adaptiveBundle.version);

    // The adaptive layer entry carries the chosen allocation's
    // bucket-range share as its propensity.
    expect(exposureEvent!.layers).toHaveLength(1);
    expect([0.25, 0.75]).toContain(exposureEvent!.layers[0].probability!);

    const decisionEvent = events.find((e) => e.type === "decision") as
      | (TrackableEvent & { configVersion?: string })
      | undefined;
    expect(decisionEvent).toBeDefined();
    expect(decisionEvent!.configVersion).toBe(adaptiveBundle.version);

    await client.destroy();
  });

  test("configVersion is snapshotted at decide() time, not event-build time", async () => {
    const events: TrackableEvent[] = [];
    const bundleV2 = {
      ...adaptiveBundle,
      version: "2024-06-01T00:00:00.000Z",
    };
    const fetchMock = mock(async () => {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => bundleV2,
        headers: new Headers({ ETag: '"v2"' }),
      } as unknown as Response;
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new TrafficalClient({
      orgId: "org_test",
      projectId: "proj_test",
      env: "production",
      apiKey: "traffical_sk_test",
      refreshIntervalMs: -1,
      disableCloudEvents: true,
      localConfig: adaptiveBundle,
      eventLogger: (event) => events.push(event),
    });

    // Decide against the v1 bundle, THEN refresh to v2 before the
    // exposure event is built.
    const decision = client.decide({
      context: { userId: "user-v1" },
      defaults: { "pricing.discount": 0 },
    });
    expect(decision.metadata.configVersion).toBe(adaptiveBundle.version);

    await client.refreshConfig();
    expect(client.getConfigVersion()).toBe(bundleV2.version);

    client.trackExposure(decision);

    // The exposure event carries the decision-time snapshot (v1), not the
    // bundle version current at event-build time (v2).
    const exposureEvent = events.find((e) => e.type === "exposure") as
      | (TrackableEvent & { configVersion?: string })
      | undefined;
    expect(exposureEvent).toBeDefined();
    expect(exposureEvent!.configVersion).toBe(adaptiveBundle.version);

    // A fresh decision evaluates against (and snapshots) the new version.
    const decisionV2 = client.decide({
      context: { userId: "user-v2" },
      defaults: { "pricing.discount": 0 },
    });
    expect(decisionV2.metadata.configVersion).toBe(bundleV2.version);

    await client.destroy();
  });

  test("assignmentLogger entries carry bucket, propensity, and configVersion", async () => {
    const entries: AssignmentLogEntry[] = [];

    const client = new TrafficalClient({
      orgId: "org_test",
      projectId: "proj_test",
      env: "production",
      apiKey: "traffical_sk_test",
      refreshIntervalMs: -1,
      disableCloudEvents: true,
      localConfig: adaptiveBundle,
      assignmentLogger: (entry) => entries.push(entry),
    });

    client.decide({
      context: { userId: "user-1" },
      defaults: { "pricing.discount": 0 },
    });

    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry.type).toBe("decision");
    expect(entry.bucket).toBeGreaterThanOrEqual(0);
    expect(entry.bucket).toBeLessThan(1000);
    // Adaptive policy: the chosen allocation's bucket-range share.
    expect([0.25, 0.75]).toContain(entry.probability!);
    // Not a contextual selection — no model version.
    expect(entry.modelVersion).toBeUndefined();
    expect(entry.configVersion).toBe(adaptiveBundle.version);

    await client.destroy();
  });
});
