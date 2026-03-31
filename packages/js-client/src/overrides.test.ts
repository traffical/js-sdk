/**
 * Tests for TrafficalClient parameter overrides (Option D).
 *
 * Validates that:
 * - applyOverrides/clearOverrides/getOverrides work on the client
 * - Overrides are applied post-resolution in decide() and getParams()
 * - Overrides only affect keys present in defaults
 * - Debug plugin delegates override operations to the client API
 * - destroy() clears overrides
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { TrafficalClient } from "./client.js";
import { createDebugPlugin } from "./plugins/debug.js";
import type { ConfigBundle } from "@traffical/core";

const originalFetch = globalThis.fetch;

// Polyfill window for Bun test env (debug plugin needs it for __TRAFFICAL_DEBUG__)
if (typeof globalThis.window === "undefined") {
  (globalThis as any).window = globalThis;
}

const testBundle: ConfigBundle = {
  version: "2024-01-01T00:00:00Z",
  orgId: "org_test",
  projectId: "proj_test",
  env: "production",
  hashing: { unitKey: "userId", bucketCount: 1000 },
  parameters: [
    { key: "feature.enabled", type: "boolean", default: false, layerId: "layer_1" },
    { key: "feature.color", type: "string", default: "blue", layerId: "layer_1" },
    { key: "feature.count", type: "number", default: 10, layerId: "layer_1" },
  ],
  layers: [
    {
      id: "layer_1",
      policies: [
        {
          id: "policy_1",
          state: "running",
          kind: "static" as const,
          conditions: [],
          allocations: [
            {
              id: "alloc_control",
              name: "control",
              bucketRange: [0, 999] as [number, number],
              overrides: {
                "feature.enabled": false,
                "feature.color": "blue",
                "feature.count": 10,
              },
            },
          ],
        },
      ],
    },
  ],
};

beforeEach(() => {
  globalThis.fetch = mock(async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => testBundle,
    headers: new Headers({ ETag: '"v1"' }),
  })) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete (globalThis as any).__TRAFFICAL_DEBUG__;
});

function createClient(plugins?: any[]) {
  return new TrafficalClient({
    orgId: "org_test",
    projectId: "proj_test",
    env: "production",
    apiKey: "pk_test",
    refreshIntervalMs: -1,
    trackDecisions: false,
    localConfig: testBundle,
    plugins,
  });
}

// =========================================================================
// Client-level override API
// =========================================================================

describe("TrafficalClient parameter overrides", () => {
  test("applyOverrides sets overrides", () => {
    const client = createClient();
    client.applyOverrides({ "feature.enabled": true });

    expect(client.getOverrides()).toEqual({ "feature.enabled": true });
    client.destroy();
  });

  test("applyOverrides merges with existing overrides", () => {
    const client = createClient();
    client.applyOverrides({ "feature.enabled": true });
    client.applyOverrides({ "feature.color": "red" });

    expect(client.getOverrides()).toEqual({
      "feature.enabled": true,
      "feature.color": "red",
    });
    client.destroy();
  });

  test("clearOverrides removes all overrides", () => {
    const client = createClient();
    client.applyOverrides({ "feature.enabled": true, "feature.color": "red" });
    client.clearOverrides();

    expect(client.getOverrides()).toEqual({});
    client.destroy();
  });

  test("getOverrides returns a copy", () => {
    const client = createClient();
    client.applyOverrides({ "feature.enabled": true });

    const copy = client.getOverrides();
    copy["feature.enabled"] = false;

    expect(client.getOverrides()).toEqual({ "feature.enabled": true });
    client.destroy();
  });

  test("destroy() clears overrides", () => {
    const client = createClient();
    client.applyOverrides({ "feature.enabled": true });
    client.destroy();

    expect(client.getOverrides()).toEqual({});
  });

  test("overrides apply to decide() assignments", async () => {
    const client = createClient();
    await client.initialize();

    client.applyOverrides({ "feature.enabled": true });

    const decision = client.decide({
      context: { userId: "user_1" },
      defaults: { "feature.enabled": false, "feature.color": "blue" },
    });

    expect(decision.assignments["feature.enabled"]).toBe(true);
    expect(decision.assignments["feature.color"]).toBe("blue");

    client.destroy();
  });

  test("overrides apply to getParams() result", async () => {
    const client = createClient();
    await client.initialize();

    client.applyOverrides({ "feature.color": "red" });

    const params = client.getParams({
      context: { userId: "user_1" },
      defaults: { "feature.color": "blue", "feature.count": 10 },
    });

    expect(params["feature.color"]).toBe("red");
    expect(params["feature.count"]).toBe(10);

    client.destroy();
  });

  test("overrides only affect keys present in defaults", async () => {
    const client = createClient();
    await client.initialize();

    client.applyOverrides({ "feature.enabled": true, "nonexistent.key": "value" });

    const decision = client.decide({
      context: { userId: "user_1" },
      defaults: { "feature.enabled": false },
    });

    expect(decision.assignments["feature.enabled"]).toBe(true);
    expect(decision.assignments).not.toHaveProperty("nonexistent.key");

    client.destroy();
  });

  test("clearing overrides restores original values", async () => {
    const client = createClient();
    await client.initialize();

    client.applyOverrides({ "feature.enabled": true });

    const overridden = client.decide({
      context: { userId: "user_1" },
      defaults: { "feature.enabled": false },
    });
    expect(overridden.assignments["feature.enabled"]).toBe(true);

    client.clearOverrides();

    const restored = client.decide({
      context: { userId: "user_1" },
      defaults: { "feature.enabled": false },
    });
    expect(restored.assignments["feature.enabled"]).toBe(false);

    client.destroy();
  });

  test("multiple overrides apply simultaneously", async () => {
    const client = createClient();
    await client.initialize();

    client.applyOverrides({
      "feature.enabled": true,
      "feature.color": "green",
      "feature.count": 42,
    });

    const decision = client.decide({
      context: { userId: "user_1" },
      defaults: { "feature.enabled": false, "feature.color": "blue", "feature.count": 10 },
    });

    expect(decision.assignments["feature.enabled"]).toBe(true);
    expect(decision.assignments["feature.color"]).toBe("green");
    expect(decision.assignments["feature.count"]).toBe(42);

    client.destroy();
  });
});

// =========================================================================
// Debug plugin delegation (Option D)
// =========================================================================

describe("Debug plugin override delegation (Option D)", () => {
  function getDebugInstance(instanceId: string) {
    const registry = (globalThis as any).__TRAFFICAL_DEBUG__;
    return registry?.instances?.[instanceId] ?? null;
  }

  test("debug plugin setOverride delegates to client.applyOverrides", async () => {
    const debugPlugin = createDebugPlugin({ instanceId: "test-d-1" });
    const client = createClient([debugPlugin]);
    await client.initialize();

    const inst = getDebugInstance("test-d-1");
    expect(inst).not.toBeNull();

    inst.setOverride("feature.enabled", true);

    expect(client.getOverrides()).toEqual({ "feature.enabled": true });

    client.destroy();
  });

  test("debug plugin clearOverride removes a single key", async () => {
    const debugPlugin = createDebugPlugin({ instanceId: "test-d-2" });
    const client = createClient([debugPlugin]);
    await client.initialize();

    const inst = getDebugInstance("test-d-2");

    inst.setOverride("feature.enabled", true);
    inst.setOverride("feature.color", "red");
    inst.clearOverride("feature.enabled");

    expect(client.getOverrides()).toEqual({ "feature.color": "red" });

    client.destroy();
  });

  test("debug plugin clearAllOverrides clears everything", async () => {
    const debugPlugin = createDebugPlugin({ instanceId: "test-d-3" });
    const client = createClient([debugPlugin]);
    await client.initialize();

    const inst = getDebugInstance("test-d-3");

    inst.setOverride("feature.enabled", true);
    inst.setOverride("feature.color", "red");
    inst.clearAllOverrides();

    expect(client.getOverrides()).toEqual({});

    client.destroy();
  });

  test("debug plugin getOverrides returns current overrides from client", async () => {
    const debugPlugin = createDebugPlugin({ instanceId: "test-d-4" });
    const client = createClient([debugPlugin]);
    await client.initialize();

    const inst = getDebugInstance("test-d-4");

    client.applyOverrides({ "feature.enabled": true });

    expect(inst.getOverrides()).toEqual({ "feature.enabled": true });

    client.destroy();
  });

  test("debug plugin state includes overrides from client", async () => {
    const debugPlugin = createDebugPlugin({ instanceId: "test-d-5" });
    const client = createClient([debugPlugin]);
    await client.initialize();

    const inst = getDebugInstance("test-d-5");

    inst.setOverride("feature.enabled", true);

    const state = inst.getState();
    expect(state.overrides).toEqual({ "feature.enabled": true });

    client.destroy();
  });

  test("overrides visible in decide() results via debug plugin", async () => {
    const debugPlugin = createDebugPlugin({ instanceId: "test-d-6" });
    const client = createClient([debugPlugin]);
    await client.initialize();

    const inst = getDebugInstance("test-d-6");

    inst.setOverride("feature.enabled", true);

    const decision = client.decide({
      context: { userId: "user_test" },
      defaults: { "feature.enabled": false, "feature.color": "blue" },
    });

    expect(decision.assignments["feature.enabled"]).toBe(true);
    expect(decision.assignments["feature.color"]).toBe("blue");

    client.destroy();
  });
});
