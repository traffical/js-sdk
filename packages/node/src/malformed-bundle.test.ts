/**
 * Malformed-bundle DISCARD (S8).
 *
 * A 200 response can still carry a structurally invalid bundle (truncated CDN
 * write, partial deploy). Serving it would corrupt every bucket assignment, so
 * `_fetchConfig` validates the hashing/shape and, on failure, discards the body,
 * logs a rate-limited warning, and KEEPS the previous last-good bundle. These
 * tests initialize against a good bundle, then feed a malformed 200 on refresh
 * and assert the good bundle is still served.
 */

import { describe, test, expect, afterEach, mock } from "bun:test";
import { TrafficalClient } from "./client.js";

const originalFetch = globalThis.fetch;
const originalWarn = console.warn;

const goodBundle = {
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

// bucketCount 0 is invalid (must be an integer >= 1).
const malformedBucketCount = {
  version: "2024-09-09T00:00:00Z",
  orgId: "org_test",
  projectId: "proj_test",
  env: "production",
  hashing: { unitKey: "userId", bucketCount: 0 },
  parameters: [
    { key: "ui.color", type: "string", default: "#ZZZ", layerId: "layer_1", namespace: "ui" },
  ],
  layers: [],
};

// unitKey missing entirely.
const malformedMissingUnitKey = {
  version: "2024-09-09T00:00:00Z",
  orgId: "org_test",
  projectId: "proj_test",
  env: "production",
  hashing: { bucketCount: 1000 },
  parameters: [
    { key: "ui.color", type: "string", default: "#ZZZ", layerId: "layer_1", namespace: "ui" },
  ],
  layers: [],
};

const clientOpts = {
  orgId: "org_test",
  projectId: "proj_test",
  env: "production",
  apiKey: "traffical_sk_test",
  refreshIntervalMs: -1, // Disable background refresh; drive refetch manually.
  trackDecisions: false,
};

/** Fetch mock that returns `bodies[callIndex]` (last body sticks) as a 200. */
function queuedFetch(bodies: unknown[]) {
  let call = 0;
  const fetchMock = mock(async () => {
    const body = bodies[Math.min(call, bodies.length - 1)];
    call++;
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => body,
      headers: new Headers({ ETag: `"v${call}"` }),
    } as unknown as Response;
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.warn = originalWarn;
});

describe("Node malformed-bundle DISCARD", () => {
  test("bucketCount 0 on refresh is discarded; last-good bundle is still served", async () => {
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
    queuedFetch([goodBundle, malformedBucketCount]);

    const client = new TrafficalClient(clientOpts);
    await client.initialize();
    expect(client.getConfigVersion()).toBe("2024-01-01T00:00:00Z");

    await client.refreshConfig();

    // Malformed 200 discarded: version + resolved value stay on the good bundle.
    expect(client.getConfigVersion()).toBe("2024-01-01T00:00:00Z");
    const params = client.getParams({ userId: "user-1" }, { "ui.color": "#000" });
    expect(params["ui.color"]).toBe("#AAA");
    expect(warnings.some((w) => w.includes("malformed config bundle"))).toBe(true);

    await client.destroy();
  });

  test("missing unitKey on refresh is discarded; last-good bundle is still served", async () => {
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
    queuedFetch([goodBundle, malformedMissingUnitKey]);

    const client = new TrafficalClient(clientOpts);
    await client.initialize();
    expect(client.getConfigVersion()).toBe("2024-01-01T00:00:00Z");

    await client.refreshConfig();

    expect(client.getConfigVersion()).toBe("2024-01-01T00:00:00Z");
    const params = client.getParams({ userId: "user-1" }, { "ui.color": "#000" });
    expect(params["ui.color"]).toBe("#AAA");
    expect(warnings.some((w) => w.includes("malformed config bundle"))).toBe(true);

    await client.destroy();
  });
});
