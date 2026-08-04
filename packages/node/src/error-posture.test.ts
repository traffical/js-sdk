/**
 * Error-posture contract for the Node SDK.
 *
 * Three tiers, and the rule that binds them: a lower tier must never change a
 * higher tier's answer. See docs/design/sdk-error-posture.md.
 */

import { describe, test, expect, mock } from "bun:test";
import type { ConfigBundle } from "@traffical/core";
import { TrafficalClient } from "./client.js";

const BASE = {
  orgId: "org_test",
  projectId: "proj_test",
  env: "production",
  apiKey: "traffical_sk_test",
  refreshIntervalMs: -1,
  trackDecisions: false,
  disableCloudEvents: true,
} as const;

function bundle(): ConfigBundle {
  return {
    version: "2024-01-01T00:00:00.000Z",
    orgId: "org_test",
    projectId: "proj_test",
    env: "production",
    hashing: { unitKey: "userId", bucketCount: 1000 },
    parameters: [{ key: "ui.color", type: "string", default: "#DEFAULT", layerId: "layer_ui" }],
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
                overrides: { "ui.color": "#TREATMENT" },
              },
            ],
          },
        ],
      },
    ],
  } as unknown as ConfigBundle;
}

// =============================================================================
// Tier 1 — a failing sink costs a log row, never a variant
// =============================================================================

describe("Tier 1: customer callbacks never change a caller's answer", () => {
  test("a throwing assignmentLogger does not propagate, and does not alter the decision", () => {
    const client = new TrafficalClient({
      ...BASE,
      localConfig: bundle(),
      assignmentLogger: () => { throw new Error("jitsu queue full"); },
    });

    let decision!: ReturnType<TrafficalClient["decide"]>;
    expect(() => { decision = client.decide({ userId: "u1" }, { "ui.color": "#CALLER" }); }).not.toThrow();

    // The unit WAS bucketed into treatment. A sink failure must not silently
    // downgrade that to control — a bounded queue throws exactly when traffic
    // spikes, which would put a load-correlated confound into the assignment.
    expect(decision.assignments["ui.color"]).toBe("#TREATMENT");
    expect(decision.metadata.layers).toHaveLength(1);
    expect(decision.metadata.reason).toBe("resolved");
    expect(client.getDiagnostics().droppedAssignmentLogs).toBe(1);
  });

  test("decide() and getParams() agree when the sink is broken", () => {
    const client = new TrafficalClient({
      ...BASE,
      localConfig: bundle(),
      assignmentLogger: () => { throw new Error("boom"); },
    });
    const viaDecide = client.decide({ userId: "u1" }, { "ui.color": "#CALLER" });
    const viaParams = client.getParams({ userId: "u1" }, { "ui.color": "#CALLER" });
    expect(viaDecide.assignments["ui.color"]).toBe(viaParams["ui.color"]);
  });

  test("a throwing assignmentLogger stays contained in strict mode too", () => {
    const client = new TrafficalClient({
      ...BASE,
      localConfig: bundle(),
      onResolutionError: "throw",
      assignmentLogger: () => { throw new Error("boom"); },
    });
    // Strictness is about resolution. It must not turn the customer's own
    // logging sink into an exception in their request path.
    expect(() => client.decide({ userId: "u1" }, { "ui.color": "#CALLER" })).not.toThrow();
    expect(client.getDiagnostics().droppedAssignmentLogs).toBe(1);
  });

  test("a throwing eventLogger is contained and counted", () => {
    const client = new TrafficalClient({
      ...BASE,
      localConfig: bundle(),
      eventLogger: () => { throw new Error("sink down"); },
    });
    expect(() => client.track("purchase", {}, { unitKey: "u1" })).not.toThrow();
    expect(client.getDiagnostics().droppedEventLogs).toBe(1);
  });

  test("trackExposure still emits its exposure entry when the decision entry threw", () => {
    const seen: string[] = [];
    let calls = 0;
    const client = new TrafficalClient({
      ...BASE,
      localConfig: bundle(),
      assignmentLogger: (e) => {
        calls++;
        if (e.type === "decision") throw new Error("transient");
        seen.push(e.type);
      },
    });
    const decision = client.decide({ userId: "u1" }, { "ui.color": "#CALLER" });
    client.trackExposure(decision);
    expect(calls).toBe(2);
    expect(seen).toEqual(["exposure"]);
  });
});

// =============================================================================
// Tier 2 — resolution failures, and the onResolutionError switch
// =============================================================================

describe("Tier 2: resolution", () => {
  test("metadata.reason distinguishes resolved / default / no-bundle", () => {
    const withPolicy = new TrafficalClient({ ...BASE, localConfig: bundle() });
    expect(withPolicy.decide({ userId: "u1" }, { "ui.color": "#C" }).metadata.reason).toBe("resolved");

    const noBundle = new TrafficalClient({ ...BASE });
    expect(noBundle.decide({ userId: "u1" }, { "ui.color": "#C" }).metadata.reason).toBe("no-bundle");

    const empty = bundle();
    (empty.layers as unknown as Array<{ policies: unknown[] }>)[0]!.policies = [];
    const noMatch = new TrafficalClient({ ...BASE, localConfig: empty });
    expect(noMatch.decide({ userId: "u1" }, { "ui.color": "#C" }).metadata.reason).toBe("default");
  });

  test('default mode returns caller defaults with reason "error"', () => {
    const client = new TrafficalClient({ ...BASE, localConfig: bundle() });
    // Force a resolution failure from inside the engine.
    (client as unknown as { _getEffectiveBundle: () => never })._getEffectiveBundle = () => {
      throw new Error("engine exploded");
    };
    const decision = client.decide({ userId: "u1" }, { "ui.color": "#CALLER" });
    expect(decision.assignments["ui.color"]).toBe("#CALLER");
    expect(decision.metadata.reason).toBe("error");
    expect(decision.decisionId).toMatch(/^dec_/);
    expect(client.getDiagnostics().resolutionErrors).toBe(1);
  });

  test('"throw" mode rethrows the resolution failure', () => {
    const client = new TrafficalClient({ ...BASE, localConfig: bundle(), onResolutionError: "throw" });
    (client as unknown as { _getEffectiveBundle: () => never })._getEffectiveBundle = () => {
      throw new Error("engine exploded");
    };
    expect(() => client.decide({ userId: "u1" }, { "ui.color": "#C" })).toThrow("engine exploded");
  });

  test("onError observes contained failures", () => {
    const onError = mock((_tag: string, _err: Error) => {});
    const client = new TrafficalClient({
      ...BASE,
      localConfig: bundle(),
      onError,
      assignmentLogger: () => { throw new Error("boom"); },
    });
    client.decide({ userId: "u1" }, { "ui.color": "#C" });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBe("assignmentLogger");
  });
});

// =============================================================================
// Tier 3 — ingestion, at every entry point
// =============================================================================

describe("Tier 3: bundle ingestion", () => {
  test("a malformed nested localConfig is rejected instead of crashing decide()", () => {
    const broken = bundle();
    // The exact shape that threw out of the resolver into the host.
    delete (broken.layers as unknown as Array<Record<string, unknown>>)[0]!.policies;

    const client = new TrafficalClient({ ...BASE, localConfig: broken });

    let params!: Record<string, unknown>;
    expect(() => { params = client.getParams({ userId: "u1" }, { "ui.color": "#CALLER" }); }).not.toThrow();
    expect(params["ui.color"]).toBe("#CALLER");
    expect(client.getDiagnostics().rejectedBundles).toBe(1);
  });

  test("localConfig is validated at all — it used to be trusted implicitly", () => {
    const client = new TrafficalClient({
      ...BASE,
      localConfig: { hashing: { unitKey: "userId", bucketCount: 1000 } } as unknown as ConfigBundle,
    });
    expect(client.getDiagnostics().rejectedBundles).toBe(1);
    expect(client.getConfigVersion()).toBeNull();
  });

  test("a rejected bundle is dropped whole, never partially applied", () => {
    const broken = bundle();
    (broken.layers as unknown as Array<{ policies: Array<{ allocations: unknown }> }>)[0]!
      .policies[0]!.allocations = "not-an-array" as unknown as unknown[];

    const client = new TrafficalClient({ ...BASE, localConfig: broken });
    // Not "resolve what parses and skip the rest" — the caller's defaults win.
    expect(client.getParams({ userId: "u1" }, { "ui.color": "#CALLER" })["ui.color"]).toBe("#CALLER");
  });

  test("a valid localConfig still resolves normally", () => {
    const client = new TrafficalClient({ ...BASE, localConfig: bundle() });
    expect(client.getParams({ userId: "u1" }, { "ui.color": "#CALLER" })["ui.color"]).toBe("#TREATMENT");
    expect(client.getDiagnostics().rejectedBundles).toBe(0);
  });
});
