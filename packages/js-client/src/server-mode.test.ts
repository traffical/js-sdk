/**
 * Server Mode Tests
 *
 * Tests for TrafficalClient in server evaluation mode.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { TrafficalClient } from "./client.js";

// =============================================================================
// Mock Fetch
// =============================================================================

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof mock>;

const serverResolveResponse = {
  decisionId: "dec_server_1",
  assignments: {
    "ui.color": "#F00",
    "pricing.discount": 15,
  },
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

function setupFetchMock(response: unknown = serverResolveResponse) {
  fetchMock = mock(async (_url: string) => {
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => response,
      headers: new Headers({ ETag: '"v1"' }),
    } as unknown as Response;
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
}

const clientOpts = {
  orgId: "org_test",
  projectId: "proj_test",
  env: "production",
  apiKey: "traffical_sk_test",
  refreshIntervalMs: -1, // Disable background refresh for tests
  trackDecisions: false,
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// =============================================================================
// Server Mode Tests
// =============================================================================

describe("TrafficalClient server mode", () => {
  test("initialize() calls /v1/resolve in server mode", async () => {
    setupFetchMock();

    const client = new TrafficalClient({
      ...clientOpts,
      evaluationMode: "server",
    });

    await client.initialize();

    expect(fetchMock).toHaveBeenCalled();
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/resolve");
  });

  test("getParams() returns from cached server response", async () => {
    setupFetchMock();

    const client = new TrafficalClient({
      ...clientOpts,
      evaluationMode: "server",
    });

    await client.initialize();

    const params = client.getParams({
      context: { userId: "user-1" },
      defaults: {
        "ui.color": "#000",
        "pricing.discount": 0,
      },
    });

    expect(params["ui.color"]).toBe("#F00");
    expect(params["pricing.discount"]).toBe(15);
  });

  test("getParams() returns defaults for keys not in server response", async () => {
    setupFetchMock();

    const client = new TrafficalClient({
      ...clientOpts,
      evaluationMode: "server",
    });

    await client.initialize();

    const params = client.getParams({
      context: { userId: "user-1" },
      defaults: {
        "ui.color": "#000",
        "unknown.param": "fallback",
      },
    });

    expect(params["ui.color"]).toBe("#F00");
    expect(params["unknown.param"]).toBe("fallback");
  });

  test("decide() returns cached decision in server mode", async () => {
    setupFetchMock();

    const client = new TrafficalClient({
      ...clientOpts,
      evaluationMode: "server",
    });

    await client.initialize();

    const decision = client.decide({
      context: { userId: "user-1" },
      defaults: { "ui.color": "#000" },
    });

    expect(decision.decisionId).toBe("dec_server_1");
    expect(decision.assignments["ui.color"]).toBe("#F00");
    expect(decision.metadata.layers).toHaveLength(1);
    expect(decision.metadata.layers[0].policyId).toBe("pol_1");
  });

  test("refreshConfig() re-calls resolve in server mode", async () => {
    let callCount = 0;
    const responses = [
      serverResolveResponse,
      {
        ...serverResolveResponse,
        decisionId: "dec_server_2",
        assignments: { "ui.color": "#0F0", "pricing.discount": 25 },
      },
    ];

    fetchMock = mock(async () => {
      const resp = responses[callCount] ?? responses[0];
      callCount++;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => resp,
        headers: new Headers(),
      } as unknown as Response;
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new TrafficalClient({
      ...clientOpts,
      evaluationMode: "server",
    });

    await client.initialize();

    let params = client.getParams({
      context: { userId: "user-1" },
      defaults: { "ui.color": "#000" },
    });
    expect(params["ui.color"]).toBe("#F00");

    await client.refreshConfig();

    params = client.getParams({
      context: { userId: "user-1" },
      defaults: { "ui.color": "#000" },
    });
    expect(params["ui.color"]).toBe("#0F0");
  });

  test("getConfigVersion() returns stateVersion in server mode", async () => {
    setupFetchMock();

    const client = new TrafficalClient({
      ...clientOpts,
      evaluationMode: "server",
    });

    await client.initialize();

    expect(client.getConfigVersion()).toBe("2024-01-01T00:00:00Z");
  });
});

// =============================================================================
// Bundle Mode Tests (backwards compat)
// =============================================================================

describe("TrafficalClient bundle mode (default)", () => {
  test("initialize() calls /v1/config in bundle mode", async () => {
    const bundleResponse = {
      version: "2024-01-01T00:00:00Z",
      orgId: "org_test",
      projectId: "proj_test",
      env: "production",
      hashing: { unitKey: "userId", bucketCount: 1000 },
      parameters: [
        { key: "ui.color", type: "string", default: "#AAA", layerId: "layer_1", namespace: "ui" },
      ],
      layers: [],
    };

    fetchMock = mock(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => bundleResponse,
      headers: new Headers({ ETag: '"v1"' }),
    })) as unknown as ReturnType<typeof mock>;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new TrafficalClient(clientOpts);
    await client.initialize();

    expect(fetchMock).toHaveBeenCalled();
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/config/");
  });
});
