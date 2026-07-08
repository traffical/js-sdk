/**
 * Smoke test: the browser SDK exposes the adapter-facing bundle accessors
 * (getUnitKeyField / getParameterLayerId) used by wrappers such as the
 * OpenFeature provider. The underlying logic is covered in core; this only
 * verifies the client delegates to the loaded bundle.
 *
 * Uses localConfig so no fetch/initialize (and no background timers) are needed
 * — the accessors read _getEffectiveBundle(), which falls back to localConfig.
 */

import { describe, test, expect } from "bun:test";
import { TrafficalClient } from "./client.js";
import type { ConfigBundle } from "@traffical/core";

// Polyfill window for the Bun test env (mirrors other js-client tests).
if (typeof globalThis.window === "undefined") {
  (globalThis as any).window = globalThis;
}

const bundle: ConfigBundle = {
  version: "2026-01-01T00:00:00Z",
  orgId: "org_1",
  projectId: "proj_1",
  env: "production",
  hashing: { unitKey: "visitorId", bucketCount: 1000 },
  parameters: [
    { key: "ui.color", type: "string", default: "#000", layerId: "layer_a", namespace: "ui" },
  ],
  layers: [{ id: "layer_a", policies: [] }],
};

describe("js-client bundle accessors", () => {
  test("getUnitKeyField / getParameterLayerId read from localConfig", () => {
    const client = new TrafficalClient({
      orgId: "org_1",
      projectId: "proj_1",
      env: "production",
      apiKey: "traffical_sk_test",
      refreshIntervalMs: -1,
      localConfig: bundle,
    });

    expect(client.getUnitKeyField()).toBe("visitorId");
    expect(client.getParameterLayerId("ui.color")).toBe("layer_a");
    expect(client.getParameterLayerId("nope")).toBeNull();

    client.destroy();
  });
});
