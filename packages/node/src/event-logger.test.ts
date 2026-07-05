/**
 * Event Logger Tests (Node SDK)
 *
 * Verifies the BYO `eventLogger` receives full events (decision/exposure/track)
 * and fires even when `disableCloudEvents` is true (so events can be routed to a
 * customer sink instead of the Traffical edge).
 */

import { describe, test, expect, afterEach, mock } from "bun:test";
import type { TrackableEvent } from "@traffical/core";
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
  trackDecisions: true,
  evaluationMode: "server" as const,
  disableCloudEvents: true,
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Node TrafficalClient eventLogger", () => {
  test("decide() emits a decision event even with disableCloudEvents", async () => {
    setupFetchMock();
    const events: TrackableEvent[] = [];

    const client = new TrafficalClient({
      ...clientOpts,
      eventLogger: (event) => events.push(event),
    });
    await client.initialize();

    client.decide({ context: { userId: "user-1" }, defaults: { "ui.color": "#000" } });

    const decisions = events.filter((e) => e.type === "decision");
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.unitKey).toBe("user-1");

    await client.destroy();
  });

  test("decision and exposure events carry configVersion", async () => {
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
    // Server mode: getConfigVersion() surfaces the resolve stateVersion.
    expect((decisionEvent as { configVersion?: string }).configVersion).toBe(
      serverResolveResponse.stateVersion
    );
    expect((exposureEvent as { configVersion?: string }).configVersion).toBe(
      serverResolveResponse.stateVersion
    );

    await client.destroy();
  });

  test("configVersion is snapshotted at decide() time, not event-build time", async () => {
    // The mock serves stateVersion v1 first, then v2 after the refresh.
    let stateVersion = "2024-01-01T00:00:00Z";
    const fetchMock = mock(async () => {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ ...serverResolveResponse, stateVersion }),
        headers: new Headers({ ETag: '"v1"' }),
      } as unknown as Response;
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const events: TrackableEvent[] = [];
    const client = new TrafficalClient({
      ...clientOpts,
      eventLogger: (event) => events.push(event),
    });
    await client.initialize();

    // Decide against v1, THEN refresh to v2 before the exposure is built.
    const decision = client.decide({
      context: { userId: "user-1" },
      defaults: { "ui.color": "#000" },
    });
    expect(decision.metadata.configVersion).toBe("2024-01-01T00:00:00Z");

    stateVersion = "2024-06-01T00:00:00Z";
    await client.refreshConfig();
    expect(client.getConfigVersion()).toBe("2024-06-01T00:00:00Z");

    client.trackExposure(decision);

    // The exposure event carries the decision-time snapshot (v1), not the
    // stateVersion current at event-build time (v2).
    const exposureEvent = events.find((e) => e.type === "exposure");
    expect(exposureEvent).toBeDefined();
    expect((exposureEvent as { configVersion?: string }).configVersion).toBe(
      "2024-01-01T00:00:00Z"
    );

    await client.destroy();
  });

  test("trackExposure() and track() emit exposure + track events", async () => {
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
    client.track("add_to_cart", { value: 12.5 }, { unitKey: "user-1" });

    expect(events.some((e) => e.type === "exposure")).toBe(true);
    const trackEvents = events.filter((e) => e.type === "track");
    expect(trackEvents).toHaveLength(1);
    expect(trackEvents[0]).toMatchObject({ event: "add_to_cart", value: 12.5 });

    await client.destroy();
  });

  test("does not send to the edge batcher when disableCloudEvents is true", async () => {
    const fetchMock = setupFetchMock();
    const events: TrackableEvent[] = [];

    const client = new TrafficalClient({
      ...clientOpts,
      eventLogger: (event) => events.push(event),
    });
    await client.initialize();

    const callsAfterInit = fetchMock.mock.calls.length;

    const decision = client.decide({
      context: { userId: "user-1" },
      defaults: { "ui.color": "#000" },
    });
    client.trackExposure(decision);
    await client.flushEvents();

    // No additional fetch calls for event delivery (only resolve happened at init).
    expect(fetchMock.mock.calls.length).toBe(callsAfterInit);
    expect(events.length).toBeGreaterThan(0);

    await client.destroy();
  });
});
