/**
 * Warehouse-native logger availability + end-to-end wiring on Node.
 *
 * The factory lives in `@traffical/core-io` and reaches `@traffical/node`
 * through its `export *`. Before that move it was only exported from
 * `@traffical/js-client` (a browser package), so the server-side
 * bring-your-own-warehouse path — the one that actually needs a Jitsu sink —
 * had no built-in destination at all.
 */

import { describe, test, expect, mock } from "bun:test";
import type { ConfigBundle } from "@traffical/core";
import { createWarehouseNativeLogger, createWarehouseNativeLoggerPlugin } from "./index.js";
import { TrafficalClient } from "./client.js";

const bundle = {
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

describe("@traffical/node warehouse-native logger", () => {
  test("the factory is reachable from the package entrypoint", () => {
    expect(typeof createWarehouseNativeLogger).toBe("function");
    expect(typeof createWarehouseNativeLoggerPlugin).toBe("function");
  });

  test("client → Jitsu: the posted row carries the stable warehouse-join keys", () => {
    const fetchImpl = mock(
      async (_url: string, _init: RequestInit) => ({ ok: true, status: 200 }) as unknown as Response,
    );

    const { assignmentLogger } = createWarehouseNativeLogger({
      destination: {
        type: "jitsu",
        host: "https://ingest.example.com",
        mode: "s2s",
        writeKey: "wk_test",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    });

    const client = new TrafficalClient({
      orgId: "org_test",
      projectId: "proj_test",
      env: "production",
      apiKey: "traffical_sk_test",
      refreshIntervalMs: -1,
      trackDecisions: false,
      disableCloudEvents: true,
      localConfig: bundle,
      assignmentLogger,
    });

    client.decide({ userId: "user-1" }, { "ui.color": "#000" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://ingest.example.com/api/s/s2s/track");
    expect((init.headers as Record<string, string>)["X-Write-Key"]).toBe("wk_test");

    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ type: "track", event: "Experiment Assignment", userId: "user-1" });
    // The end-to-end guarantee: an assignment definition mapping `policy_key`
    // has a real policy key to join on, not an opaque `policy_01`.
    expect(body.properties).toMatchObject({
      policy_id: "policy_01",
      policy_key: "color-test",
      allocation_name: "treatment",
      allocation_key: "treatment-key",
      type: "decision",
    });
  });
});
