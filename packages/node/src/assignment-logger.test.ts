/**
 * Assignment Logger Tests (Node SDK)
 *
 * Verifies the BYO `assignmentLogger` emits decision/exposure rows with the
 * warehouse-native fields (`type`, `decisionId`, `anonymousId`, `id`) and that
 * `type` participates in deduplication.
 */

import { describe, test, expect, afterEach, mock } from "bun:test";
import type { AssignmentLogEntry } from "@traffical/core";
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
    expect(entry.decisionId).toBe("dec_server_1");
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
