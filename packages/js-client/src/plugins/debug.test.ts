import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createDebugPlugin, type TrafficalDebugInstance } from "./debug";
import type { PluginClientAPI } from "./types";
import type { Context, DecisionResult, ParameterValue } from "@traffical/core";

const OPENFEATURE_API_SYMBOL = Symbol.for("@openfeature/web-sdk/api");

/**
 * A client stand-in that runs the plugin's hooks the way TrafficalClient.decide
 * does: onBeforeDecision (context) → resolve → onDecision (result).
 */
function makeClient() {
  const calls: Array<{ context: Context; defaults: Record<string, ParameterValue> }> = [];
  const plugin = createDebugPlugin({ instanceId: "test" });
  const client: PluginClientAPI = {
    decide<T extends Record<string, ParameterValue>>(options: { context: Context; defaults: T }) {
      const context = (plugin.onBeforeDecision?.(options.context) as Context | undefined) ?? options.context;
      calls.push({ context, defaults: options.defaults });
      const decision: DecisionResult = {
        decisionId: `dec_${calls.length}`,
        assignments: { ...options.defaults },
        metadata: { timestamp: "", unitKeyValue: String(context.userId ?? ""), layers: [] },
      };
      plugin.onDecision?.(decision);
      return decision as DecisionResult<T>;
    },
    getParams: () => ({}) as never,
    track: () => {},
    trackExposure: () => {},
    isInitialized: true,
  };
  plugin.onInitialize?.(client);
  const instance = (globalThis as { window?: Window }).window?.__TRAFFICAL_DEBUG__?.instances["test"] as
    | TrafficalDebugInstance
    | undefined;
  return { client, plugin, calls, instance: instance! };
}

describe("debug plugin: context overrides + re-decide", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).window = globalThis;
  });
  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[OPENFEATURE_API_SYMBOL];
    delete (globalThis as { window?: unknown }).window;
  });

  test("reDecide replays the app's last context and parameter set", () => {
    const { client, calls, instance } = makeClient();
    client.decide({ context: { userId: "u1", plan: "pro" }, defaults: { "pdp.location": "bottom" } });

    instance.reDecide();

    expect(calls).toHaveLength(2);
    expect(calls[1].context).toEqual({ userId: "u1", plan: "pro" });
    expect(calls[1].defaults).toEqual({ "pdp.location": "bottom" });
  });

  test("reDecide before any app decision falls back to empty inputs", () => {
    const { calls, instance } = makeClient();
    instance.reDecide();
    expect(calls).toEqual([{ context: {}, defaults: {} }]);
  });

  test("setContextOverrides merges into every decision and re-decides", () => {
    const { client, calls, instance } = makeClient();
    client.decide({ context: { userId: "u1" }, defaults: { "pdp.location": "bottom" } });

    instance.setContextOverrides({ testMode: "1" });

    expect(calls).toHaveLength(2);
    expect(calls[1].context).toEqual({ userId: "u1", testMode: "1" });
    expect(instance.getContextOverrides()).toEqual({ testMode: "1" });
    expect(instance.getState().contextOverrides).toEqual({ testMode: "1" });
    // lastContext is what the app passed, without the override
    expect(instance.getState().lastContext).toEqual({ userId: "u1" });

    // A later app decision picks the override up too
    client.decide({ context: { userId: "u2" }, defaults: {} });
    expect(calls[2].context).toEqual({ userId: "u2", testMode: "1" });

    // Clearing removes it
    instance.setContextOverrides({});
    expect(calls[3].context).toEqual({ userId: "u2" });
  });

  test("reDecide nudges the OpenFeature singleton so provider-bound hooks re-render", async () => {
    const setCalls: Array<Record<string, unknown>> = [];
    const bound = { targetingKey: "anon-1" };
    (globalThis as Record<symbol, unknown>)[OPENFEATURE_API_SYMBOL] = {
      getContext: () => bound,
      setContext: async (ctx: Record<string, unknown>) => {
        setCalls.push(ctx);
      },
    };
    const { instance } = makeClient();

    instance.reDecide();
    await Promise.resolve();

    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]).toEqual(bound);
    expect(setCalls[0]).not.toBe(bound);
  });
});

// ---------------------------------------------------------------------------
// Through the real client: the Mahally QA scenario. A top-priority policy
// targets `testMode exists`; the app never sets it; the inspector does.
// ---------------------------------------------------------------------------

import { TrafficalClient } from "../client";
import { MemoryStorageProvider } from "../storage";
import type { ConfigBundle } from "@traffical/core";

const qaBundle = {
  version: "2026-09-11T00:00:00.000Z",
  orgId: "org_1",
  projectId: "proj_1",
  env: "production",
  hashing: { unitKey: "userId", bucketCount: 1000 },
  parameters: [
    { key: "pdp.location", type: "string", default: "bottom", layerId: "lay_1", namespace: "main" },
  ],
  layers: [
    {
      id: "lay_1",
      policies: [
        {
          id: "pol_qa",
          key: "qa",
          state: "running",
          kind: "static",
          conditions: [{ field: "testMode", op: "exists" }],
          allocations: [
            { id: "a_qa", name: "Control", key: "control", bucketRange: [0, 999], overrides: { "pdp.location": "middle" } },
          ],
        },
        {
          id: "pol_aa",
          key: "aa",
          state: "running",
          kind: "static",
          conditions: [],
          allocations: [
            { id: "a_c", name: "Control", key: "control", bucketRange: [0, 499], overrides: {} },
            { id: "a_t", name: "Treatment", key: "treatment", bucketRange: [500, 999], overrides: {} },
          ],
        },
      ],
    },
  ],
} as unknown as ConfigBundle;

describe("debug plugin through TrafficalClient", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).window = globalThis;
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  test("context overrides satisfy a targeting condition the app never sets", () => {
    const plugin = createDebugPlugin({ instanceId: "qa" });
    const client = new TrafficalClient({
      orgId: "org_1",
      projectId: "proj_1",
      env: "production",
      apiKey: "pk",
      localConfig: qaBundle,
      trackDecisions: false,
      disableCloudEvents: true,
      storage: new MemoryStorageProvider(),
      plugins: [plugin],
    });
    plugin.onInitialize?.(client);
    const instance = window.__TRAFFICAL_DEBUG__!.instances["qa"];

    const before = client.decide({ context: { userId: "anon-1" }, defaults: { "pdp.location": "bottom" } });
    expect(before.metadata.layers[0].policyId).toBe("pol_aa");

    instance.setContextOverrides({ testMode: "1" });

    // The replayed decision resolved the QA policy...
    expect(instance.getState().layers[0].policyId).toBe("pol_qa");
    expect(instance.getState().assignments["pdp.location"]).toBe("middle");
    // ...and so does the app's own next decision.
    const after = client.decide({ context: { userId: "anon-1" }, defaults: { "pdp.location": "bottom" } });
    expect(after.assignments["pdp.location"]).toBe("middle");
    expect(after.metadata.layers[0].policyId).toBe("pol_qa");
  });
});
