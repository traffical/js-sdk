/**
 * Config fetch timeout tests
 *
 * Validates that TrafficalClient aborts a hung config fetch after
 * requestTimeoutMs and falls back to the existing offline failure path
 * (rate-limited warning + cached/local config/defaults), and that fast
 * responses are unaffected with the abort timer cleaned up.
 */

import { describe, test, expect, afterEach, mock } from "bun:test";
import { TrafficalClient } from "./client.js";

const originalFetch = globalThis.fetch;
const originalWarn = console.warn;

const clientOpts = {
  orgId: "org_test",
  projectId: "proj_test",
  env: "production",
  apiKey: "traffical_sk_test",
  refreshIntervalMs: -1, // Disable background refresh for tests
  trackDecisions: false,
};

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

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.warn = originalWarn;
});

describe("TrafficalClient config fetch timeout", () => {
  test("aborts a hung config fetch after requestTimeoutMs and falls back to defaults", async () => {
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };

    // A fetch that never resolves, but rejects with AbortError when aborted.
    const fetchMock = mock(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new TrafficalClient({
      ...clientOpts,
      requestTimeoutMs: 20,
    });

    // Without the abort timeout, initialize() would never settle.
    await client.initialize();

    expect(client.isInitialized).toBe(true);
    expect(fetchMock).toHaveBeenCalled();

    // Existing offline failure path: warning logged, defaults served.
    expect(warnings.some((w) => w.includes("Failed to fetch config"))).toBe(true);
    const params = client.getParams({
      context: { userId: "user-1" },
      defaults: { "ui.color": "#000" },
    });
    expect(params["ui.color"]).toBe("#000");

    client.destroy();
  });

  test("fast config response is unaffected and the abort timer is cleaned up", async () => {
    let capturedSignal: AbortSignal | null | undefined;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };

    globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => bundleResponse,
        headers: new Headers({ ETag: '"v1"' }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const client = new TrafficalClient({
      ...clientOpts,
      requestTimeoutMs: 20,
    });

    await client.initialize();

    // Wait past the timeout: if the timer had leaked, the signal would abort.
    await new Promise((r) => setTimeout(r, 60));

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);
    expect(client.getConfigVersion()).toBe("2024-01-01T00:00:00Z");
    expect(warnings.some((w) => w.includes("Failed to fetch config"))).toBe(false);

    client.destroy();
  });
});
