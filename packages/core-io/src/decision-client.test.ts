/**
 * DecisionClient Tests
 *
 * Tests for the DecisionClient class with mocked fetch.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { DecisionClient, createEdgeDecideRequest } from "./decision-client.js";
import type { ServerResolveResponse, EdgeDecideResponse } from "@traffical/core";

// =============================================================================
// Mock Helpers
// =============================================================================

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof mock>;

function mockFetch(
  response: unknown,
  opts?: { status?: number; ok?: boolean; delay?: number }
) {
  const status = opts?.status ?? 200;
  const ok = opts?.ok ?? true;

  fetchMock = mock(async () => {
    if (opts?.delay) {
      await new Promise((resolve) => setTimeout(resolve, opts.delay));
    }
    return {
      ok,
      status,
      statusText: ok ? "OK" : "Error",
      json: async () => response,
      headers: new Headers(),
    } as unknown as Response;
  });

  globalThis.fetch = fetchMock as unknown as typeof fetch;
}

function mockFetchError(error: Error) {
  fetchMock = mock(async () => {
    throw error;
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
}

// =============================================================================
// Setup
// =============================================================================

const clientConfig = {
  baseUrl: "https://sdk.traffical.io",
  orgId: "org_test",
  projectId: "proj_test",
  env: "production",
  apiKey: "traffical_sk_test123",
};

beforeEach(() => {
  fetchMock = mock();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// =============================================================================
// resolve() Tests
// =============================================================================

describe("DecisionClient.resolve()", () => {
  test("sends correct request shape and headers", async () => {
    const serverResponse: ServerResolveResponse = {
      decisionId: "dec_123",
      assignments: { "ui.color": "#F00" },
      metadata: {
        timestamp: "2024-01-01T00:00:00Z",
        unitKeyValue: "user-1",
        layers: [],
      },
      stateVersion: "v1",
      suggestedRefreshMs: 60000,
    };

    mockFetch(serverResponse);

    const client = new DecisionClient(clientConfig);
    const result = await client.resolve({
      context: { userId: "user-1" },
      env: "staging",
      parameters: ["ui.color"],
    });

    expect(result).toEqual(serverResponse);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://sdk.traffical.io/v1/resolve");
    expect(options.method).toBe("POST");

    const headers = options.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Authorization"]).toBe("Bearer traffical_sk_test123");
    expect(headers["X-Org-Id"]).toBe("org_test");
    expect(headers["X-Project-Id"]).toBe("proj_test");

    const body = JSON.parse(options.body as string);
    expect(body.context).toEqual({ userId: "user-1" });
    expect(body.env).toBe("staging");
    expect(body.parameters).toEqual(["ui.color"]);
  });

  test("returns null on HTTP error", async () => {
    mockFetch({ error: "not found" }, { status: 404, ok: false });

    const client = new DecisionClient(clientConfig);
    const result = await client.resolve({ context: { userId: "u1" } });

    expect(result).toBeNull();
  });

  test("returns null on network error", async () => {
    mockFetchError(new Error("Network failure"));

    const client = new DecisionClient(clientConfig);
    const result = await client.resolve({ context: { userId: "u1" } });

    expect(result).toBeNull();
  });
});

// =============================================================================
// decideEntity() Tests
// =============================================================================

describe("DecisionClient.decideEntity()", () => {
  test("sends correct request and returns response", async () => {
    const edgeResponse: EdgeDecideResponse = {
      allocationIndex: 2,
      allocationName: "2",
      weights: [0.3, 0.3, 0.4],
      coldStart: false,
      stateVersion: "v1",
    };

    mockFetch(edgeResponse);

    const client = new DecisionClient(clientConfig);
    const result = await client.decideEntity({
      policyId: "pol_123",
      entityId: "prod_42",
      unitKeyValue: "user-1",
      allocationCount: 3,
    });

    expect(result).toEqual(edgeResponse);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://sdk.traffical.io/v1/decide/pol_123");
  });

  test("returns null on HTTP error", async () => {
    mockFetch({}, { status: 500, ok: false });

    const client = new DecisionClient(clientConfig);
    const result = await client.decideEntity({
      policyId: "pol_123",
      entityId: "e1",
      unitKeyValue: "u1",
    });

    expect(result).toBeNull();
  });
});

// =============================================================================
// decideEntityBatch() Tests
// =============================================================================

describe("DecisionClient.decideEntityBatch()", () => {
  test("sends batch request for multiple entities", async () => {
    const batchResponse = {
      responses: [
        { allocationIndex: 0, allocationName: "0", weights: [0.5, 0.5], coldStart: true },
        { allocationIndex: 1, allocationName: "1", weights: [0.5, 0.5], coldStart: true },
      ],
    };

    mockFetch(batchResponse);

    const client = new DecisionClient(clientConfig);
    const results = await client.decideEntityBatch([
      { policyId: "pol_1", entityId: "e1", unitKeyValue: "u1" },
      { policyId: "pol_1", entityId: "e2", unitKeyValue: "u1" },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]!.allocationIndex).toBe(0);
    expect(results[1]!.allocationIndex).toBe(1);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://sdk.traffical.io/v1/decide/batch");
  });

  test("returns empty array for empty requests", async () => {
    const client = new DecisionClient(clientConfig);
    const results = await client.decideEntityBatch([]);
    expect(results).toEqual([]);
  });

  test("delegates single request to decideEntity", async () => {
    const singleResponse: EdgeDecideResponse = {
      allocationIndex: 0,
      allocationName: "0",
      weights: [1],
      coldStart: true,
    };

    mockFetch(singleResponse);

    const client = new DecisionClient(clientConfig);
    const results = await client.decideEntityBatch([
      { policyId: "pol_1", entityId: "e1", unitKeyValue: "u1" },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]!.allocationIndex).toBe(0);

    // Should have used /v1/decide/pol_1 (single), not /v1/decide/batch
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://sdk.traffical.io/v1/decide/pol_1");
  });

  test("returns null array on network error", async () => {
    mockFetchError(new Error("Network failure"));

    const client = new DecisionClient(clientConfig);
    const results = await client.decideEntityBatch([
      { policyId: "pol_1", entityId: "e1", unitKeyValue: "u1" },
      { policyId: "pol_1", entityId: "e2", unitKeyValue: "u1" },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]).toBeNull();
    expect(results[1]).toBeNull();
  });
});

// =============================================================================
// createEdgeDecideRequest() Tests
// =============================================================================

describe("createEdgeDecideRequest()", () => {
  test("builds request from context", () => {
    const req = createEdgeDecideRequest(
      "pol_1",
      ["productId", "regionId"],
      { productId: "prod_42", regionId: "us-east", userId: "u1" },
      "u1",
      3
    );

    expect(req).not.toBeNull();
    expect(req!.policyId).toBe("pol_1");
    expect(req!.entityId).toBe("prod_42_us-east");
    expect(req!.unitKeyValue).toBe("u1");
    expect(req!.allocationCount).toBe(3);
  });

  test("returns null when entity key is missing", () => {
    const req = createEdgeDecideRequest(
      "pol_1",
      ["productId", "regionId"],
      { productId: "prod_42" },
      "u1"
    );

    expect(req).toBeNull();
  });
});
