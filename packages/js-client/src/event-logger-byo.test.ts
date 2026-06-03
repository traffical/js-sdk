/**
 * BYO Event Logger Tests (JS Client)
 *
 * Verifies the BYO `eventLogger` receives decision/exposure/track events and
 * still fires when `disableCloudEvents` is true — including decision events,
 * which requires the decision-tracking plugin to register even when cloud
 * events are disabled.
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
});
