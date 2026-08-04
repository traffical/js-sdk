/**
 * Error-posture contract for the browser SDK.
 *
 * The headline case is the regression: `decide()` used to wrap resolution AND
 * assignment logging in one boundary with a defaults fallback, so a throwing
 * sink discarded the decision. Measured before the fix, on one client and one
 * unit: `decide()` returned control while `getParams()` returned treatment.
 */

import { describe, test, expect, mock } from "bun:test";
import type { ConfigBundle } from "@traffical/core";
import { TrafficalClient } from "./client.ts";

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

describe("regression: a failing sink must not discard the decision", () => {
  test("decide() returns the real assignment when assignmentLogger throws", () => {
    const client = new TrafficalClient({
      ...BASE,
      localConfig: bundle(),
      assignmentLogger: () => { throw new Error("queue full"); },
    });

    const decision = client.decide({ userId: "u1" }, { "ui.color": "#CALLER" });

    // Before the fix this was "#CALLER" with layers: [].
    expect(decision.assignments["ui.color"]).toBe("#TREATMENT");
    expect(decision.metadata.layers).toHaveLength(1);
    expect(decision.metadata.reason).toBe("resolved");
    expect(client.getDiagnostics().droppedAssignmentLogs).toBe(1);
  });

  test("decide() and getParams() no longer disagree for the same unit", () => {
    const client = new TrafficalClient({
      ...BASE,
      localConfig: bundle(),
      assignmentLogger: () => { throw new Error("queue full"); },
    });
    // getParams() emits no assignment rows, so it was never affected. The
    // divergence between the two was the tell.
    expect(client.decide({ userId: "u1" }, { "ui.color": "#CALLER" }).assignments["ui.color"])
      .toBe(client.getParams({ userId: "u1" }, { "ui.color": "#CALLER" })["ui.color"]);
  });

  test("trackExposure survives a throwing sink", () => {
    const client = new TrafficalClient({
      ...BASE,
      localConfig: bundle(),
      assignmentLogger: () => { throw new Error("queue full"); },
    });
    const decision = client.decide({ userId: "u1" }, { "ui.color": "#CALLER" });
    expect(() => client.trackExposure(decision)).not.toThrow();
    expect(client.getDiagnostics().droppedAssignmentLogs).toBe(2);
  });
});

describe("Tier 2 / Tier 3 parity with Node", () => {
  test('default mode returns caller defaults with reason "error"', () => {
    const client = new TrafficalClient({ ...BASE, localConfig: bundle() });
    (client as unknown as { _getEffectiveBundle: () => never })._getEffectiveBundle = () => {
      throw new Error("engine exploded");
    };
    const decision = client.decide({ userId: "u1" }, { "ui.color": "#CALLER" });
    expect(decision.assignments["ui.color"]).toBe("#CALLER");
    expect(decision.metadata.reason).toBe("error");
  });

  test('"throw" mode rethrows', () => {
    const client = new TrafficalClient({ ...BASE, localConfig: bundle(), onResolutionError: "throw" });
    (client as unknown as { _getEffectiveBundle: () => never })._getEffectiveBundle = () => {
      throw new Error("engine exploded");
    };
    expect(() => client.decide({ userId: "u1" }, { "ui.color": "#C" })).toThrow("engine exploded");
  });

  test("a malformed nested localConfig is rejected rather than crashing", () => {
    const broken = bundle();
    delete (broken.layers as unknown as Array<Record<string, unknown>>)[0]!.policies;
    const client = new TrafficalClient({ ...BASE, localConfig: broken });
    expect(client.getParams({ userId: "u1" }, { "ui.color": "#CALLER" })["ui.color"]).toBe("#CALLER");
    expect(client.getDiagnostics().rejectedBundles).toBe(1);
  });

  test("waitForReady() still resolves in strict mode when initialization fails", async () => {
    // Initialization must stay contained regardless of onResolutionError:
    // rethrowing would skip _readyResolve() and leave waitForReady() pending
    // forever — and only in the mode people enable in CI.
    const client = new TrafficalClient({
      ...BASE,
      onResolutionError: "throw",
      refreshIntervalMs: 60_000,
      baseUrl: "http://127.0.0.1:1/unreachable",
    });

    await expect(client.initialize()).resolves.toBeUndefined();
    await expect(
      Promise.race([
        client.waitForReady(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("waitForReady hung")), 2000)),
      ]),
    ).resolves.toBeUndefined();

    client.destroy();
  });

  test("the legacy errorBoundary.onError option still receives errors", () => {
    const onError = mock((_tag: string, _err: Error) => {});
    const client = new TrafficalClient({
      ...BASE,
      localConfig: bundle(),
      errorBoundary: { onError },
      assignmentLogger: () => { throw new Error("boom"); },
    });
    client.decide({ userId: "u1" }, { "ui.color": "#C" });
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
