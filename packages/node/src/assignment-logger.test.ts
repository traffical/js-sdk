/**
 * Assignment Logger Tests (Node SDK)
 *
 * Verifies the BYO `assignmentLogger` emits decision/exposure rows with the
 * warehouse-native fields (`type`, `decisionId`, `anonymousId`, `id`) and that
 * `type` participates in deduplication.
 */

import { describe, test, expect, afterEach, mock } from "bun:test";
import type { AssignmentLogEntry, ConfigBundle } from "@traffical/core";
import { TrafficalClient } from "./client.js";

const originalFetch = globalThis.fetch;

// Mirrors what the edge actually returns: `/v1/resolve` passes
// `decision.metadata` straight through from the core resolver, so the layer
// rows carry `policyKey`/`allocationKey` alongside the opaque ids.
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
        policyKey: "color-test",
        allocationId: "alloc_1",
        allocationName: "treatment",
        allocationKey: "treatment-key",
      },
    ],
  },
  stateVersion: "2024-01-01T00:00:00Z",
  suggestedRefreshMs: 30000,
};

/** Bundle whose policy/allocation keys differ from their ids and names. */
const bundleWithDistinctKeys = {
  version: "2024-01-01T00:00:00.000Z",
  orgId: "org_test",
  projectId: "proj_test",
  env: "production",
  hashing: { unitKey: "userId", bucketCount: 1000 },
  parameters: [{ key: "ui.color", type: "string", default: "#000", layerId: "layer_ui" }],
  layers: [
    {
      id: "layer_ui",
      policies: [
        {
          id: "policy_01",
          key: "color-test",
          state: "running",
          kind: "static",
          conditions: [],
          allocations: [
            {
              id: "alloc_01",
              key: "treatment-key",
              name: "treatment",
              bucketRange: [0, 999],
              overrides: { "ui.color": "#F00" },
            },
          ],
        },
      ],
    },
  ],
} as unknown as ConfigBundle;

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
  trackDecisions: false,
  evaluationMode: "server" as const,
  disableCloudEvents: true,
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Node TrafficalClient assignmentLogger", () => {
  test("decide() emits a 'decision' row with new fields (anonymousId undefined)", async () => {
    setupFetchMock();
    const entries: AssignmentLogEntry[] = [];

    const client = new TrafficalClient({
      ...clientOpts,
      assignmentLogger: (entry) => entries.push(entry),
    });
    await client.initialize();

    client.decide({ context: { userId: "user-1" }, defaults: { "ui.color": "#000" } });

    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry.type).toBe("decision");
    expect(entry.policyId).toBe("pol_1");
    expect(entry.allocationName).toBe("treatment");
    // Stable keys — what warehouse assignment definitions join on.
    expect(entry.policyKey).toBe("color-test");
    expect(entry.allocationKey).toBe("treatment-key");
    // Server mode now mints a FRESH decisionId per decide() (spec 0.7.0 S8) —
    // it no longer reuses the resolve response's decisionId across decisions.
    expect(entry.decisionId).toMatch(/^dec_/);
    expect(entry.decisionId).not.toBe("dec_server_1");
    expect(entry.anonymousId).toBeUndefined();
    expect(entry.id).toMatch(/^asn_/);
    // Warehouse-native passthrough fields from the layer resolution.
    expect(entry.bucket).toBe(500);
    expect(entry.configVersion).toBe(serverResolveResponse.stateVersion);
    // The server response carries no propensity or contextual model version.
    expect(entry.probability).toBeUndefined();
    expect(entry.modelVersion).toBeUndefined();

    await client.destroy();
  });

  test("decide() then trackExposure() produce two distinct rows (decision + exposure)", async () => {
    setupFetchMock();
    const entries: AssignmentLogEntry[] = [];

    const client = new TrafficalClient({
      ...clientOpts,
      assignmentLogger: (entry) => entries.push(entry),
    });
    await client.initialize();

    const decision = client.decide({
      context: { userId: "user-1" },
      defaults: { "ui.color": "#000" },
    });
    client.trackExposure(decision);

    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.type).sort()).toEqual(["decision", "exposure"]);
    expect(entries[0]?.id).not.toBe(entries[1]?.id);

    await client.destroy();
  });

  test("bundle mode: entries carry the stable policy/allocation keys, not just ids", () => {
    const entries: AssignmentLogEntry[] = [];

    const client = new TrafficalClient({
      ...clientOpts,
      evaluationMode: "bundle",
      localConfig: bundleWithDistinctKeys,
      assignmentLogger: (entry) => entries.push(entry),
    });

    const decision = client.decide({ userId: "user-1" }, { "ui.color": "#000" });
    client.trackExposure(decision);

    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      // The ids are opaque; the keys are the warehouse join contract. Assert
      // they are distinct values so a fallback to `policyId` can't pass.
      expect(entry.policyId).toBe("policy_01");
      expect(entry.policyKey).toBe("color-test");
      expect(entry.allocationId).toBe("alloc_01");
      expect(entry.allocationName).toBe("treatment");
      expect(entry.allocationKey).toBe("treatment-key");
    }
  });

  test("repeated decide() calls for the same unit are deduplicated", async () => {
    setupFetchMock();
    const entries: AssignmentLogEntry[] = [];

    const client = new TrafficalClient({
      ...clientOpts,
      assignmentLogger: (entry) => entries.push(entry),
    });
    await client.initialize();

    client.decide({ context: { userId: "user-1" }, defaults: { "ui.color": "#000" } });
    client.decide({ context: { userId: "user-1" }, defaults: { "ui.color": "#000" } });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.type).toBe("decision");

    await client.destroy();
  });
});
