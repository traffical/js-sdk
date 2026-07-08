/**
 * Unit tests for TrafficalServerProvider (design §11.1) — the translation
 * membrane, exercised with a STUB client implementing TrafficalClientLike (plus
 * optional lifecycle methods).
 *
 * Covers: targetingKey→unitKey mapping; owning-layer metadata selection with an
 * attributionOnly sibling present; TypeMismatch propagation; TargetingKeyMissing
 * behavior; exposure route store hit/miss (miss never decides); reward always
 * sets a unitKey; exposureOnResolve; the no-exposure alarm; runsOn; idempotent
 * onClose that flushes+destroys.
 */

import { describe, test, expect, mock } from "bun:test";
import {
  ErrorCode,
  ProviderEvents,
  TargetingKeyMissingError,
  TypeMismatchError,
} from "@openfeature/server-sdk";
import type { DecisionResult, LayerResolution, ParameterValue } from "@traffical/core";
import { EXPOSURE_EVENT_NAME } from "@traffical/openfeature-core";
import type { TrafficalProviderOptions } from "@traffical/openfeature-core";
import {
  TrafficalServerProvider,
  createTrafficalServerProvider,
  type TrafficalServerClient,
} from "./index.js";

// -----------------------------------------------------------------------------
// Stub client
// -----------------------------------------------------------------------------

interface DecideCall {
  context: Record<string, unknown>;
  defaults: Record<string, ParameterValue>;
}

interface StubOptions {
  unitKeyField?: string | null;
  /** Map of flagKey → owning layerId. */
  layerIds?: Record<string, string | null>;
  /** Build the decision returned by decide(). */
  decisionFactory?: (call: DecideCall) => DecisionResult;
  withLifecycle?: boolean;
  configVersion?: string | null;
}

class StubClient implements TrafficalServerClient {
  public decideCalls: DecideCall[] = [];
  public exposedDecisions: DecisionResult[] = [];
  public trackCalls: Array<{
    event: string;
    properties?: Record<string, unknown>;
    options?: { decisionId?: string; unitKey?: string };
  }> = [];
  public initializeCalls = 0;
  public flushCalls = 0;
  public destroyCalls = 0;

  private readonly opts: StubOptions;

  constructor(opts: StubOptions = {}) {
    this.opts = opts;
    if (opts.withLifecycle) {
      this.initialize = mock(async () => {
        this.initializeCalls += 1;
      });
      this.flushEvents = mock(async () => {
        this.flushCalls += 1;
      });
      this.destroy = mock(async () => {
        this.destroyCalls += 1;
      });
    }
  }

  initialize?: () => Promise<void>;
  flushEvents?: () => Promise<void>;
  destroy?: () => Promise<void>;

  getUnitKeyField(): string | null {
    return this.opts.unitKeyField ?? "userId";
  }

  getParameterLayerId(key: string): string | null {
    if (this.opts.layerIds && key in this.opts.layerIds) {
      return this.opts.layerIds[key]!;
    }
    return null;
  }

  getConfigVersion(): string | null {
    return this.opts.configVersion ?? "cfg_1";
  }

  decide<T extends Record<string, ParameterValue>>(options: {
    context: Record<string, unknown>;
    defaults: T;
  }): DecisionResult {
    this.decideCalls.push({ context: options.context, defaults: options.defaults });
    if (this.opts.decisionFactory) {
      return this.opts.decisionFactory(options);
    }
    // Default: echo the first default back as the assignment.
    const [flagKey] = Object.keys(options.defaults);
    return makeDecision({
      assignments: flagKey ? { [flagKey]: options.defaults[flagKey]! } : {},
      layers: [ownerLayer],
      unitKeyValue: String(options.context[this.getUnitKeyField() ?? "userId"] ?? ""),
    });
  }

  trackExposure(decision: DecisionResult): void {
    this.exposedDecisions.push(decision);
  }

  track(
    event: string,
    properties?: Record<string, unknown>,
    options?: { decisionId?: string; unitKey?: string }
  ): void {
    this.trackCalls.push({ event, properties, options });
  }
}

// -----------------------------------------------------------------------------
// Layer / decision fixtures
// -----------------------------------------------------------------------------

const ownerLayer: LayerResolution = {
  layerId: "layer_a",
  bucket: 42,
  policyId: "pol_a",
  policyKey: "checkout_button",
  allocationId: "alloc_a",
  allocationName: "treatment",
  allocationKey: "treatment",
  probability: 0.5,
};

const attributionSibling: LayerResolution = {
  layerId: "layer_b",
  bucket: 7,
  policyId: "pol_b",
  policyKey: "sibling_experiment",
  allocationId: "alloc_b",
  allocationName: "sibling_control",
  allocationKey: "sibling_control",
  probability: 0.9,
  attributionOnly: true,
};

let decisionCounter = 0;

function makeDecision(args: {
  assignments: Record<string, unknown>;
  layers: LayerResolution[];
  unitKeyValue: string;
  decisionId?: string;
}): DecisionResult {
  return {
    decisionId: args.decisionId ?? `dec_${++decisionCounter}`,
    assignments: args.assignments as DecisionResult["assignments"],
    metadata: {
      timestamp: "2026-07-08T00:00:00Z",
      unitKeyValue: args.unitKeyValue,
      layers: args.layers,
      configVersion: "cfg_1",
    },
  };
}

function makeProvider(
  stubOpts?: StubOptions,
  providerOpts?: TrafficalProviderOptions
): { provider: TrafficalServerProvider; client: StubClient } {
  const client = new StubClient(stubOpts);
  const provider = new TrafficalServerProvider(client, providerOpts);
  return { provider, client };
}

// -----------------------------------------------------------------------------
// Metadata / paradigm
// -----------------------------------------------------------------------------

describe("metadata", () => {
  test("runsOn is server and name is traffical-provider", () => {
    const { provider } = makeProvider();
    expect(provider.runsOn).toBe("server");
    expect(provider.metadata.name).toBe("traffical-provider");
    expect(provider.hooks).toEqual([]);
    expect(provider.events).toBeDefined();
  });

  test("factory produces a provider", () => {
    const client = new StubClient();
    const provider = createTrafficalServerProvider(client);
    expect(provider).toBeInstanceOf(TrafficalServerProvider);
  });
});

// -----------------------------------------------------------------------------
// targetingKey → unitKey mapping
// -----------------------------------------------------------------------------

describe("targetingKey → unitKey mapping", () => {
  test("writes targetingKey under the bundle's unit-key field", async () => {
    const { provider, client } = makeProvider({ unitKeyField: "accountId" });
    await provider.resolveStringEvaluation("flagA", "d", { targetingKey: "u1" });

    expect(client.decideCalls).toHaveLength(1);
    const ctx = client.decideCalls[0]!.context;
    expect(ctx.accountId).toBe("u1");
    expect(ctx.targetingKey).toBe("u1");
  });

  test("options.unitKey overrides the client's field", async () => {
    const { provider, client } = makeProvider(
      { unitKeyField: "userId" },
      { unitKey: "deviceId" }
    );
    await provider.resolveStringEvaluation("flagA", "d", { targetingKey: "u1", plan: "pro" });

    const ctx = client.decideCalls[0]!.context;
    expect(ctx.deviceId).toBe("u1");
    expect(ctx.plan).toBe("pro"); // extra attributes carried through
  });

  test("missing targetingKey throws TargetingKeyMissingError (not swallowed)", async () => {
    const { provider, client } = makeProvider();
    await expect(
      provider.resolveBooleanEvaluation("flagA", false, {} as never)
    ).rejects.toBeInstanceOf(TargetingKeyMissingError);
    // Never decided.
    expect(client.decideCalls).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------
// Owning-layer selection (B1/D1 regression guard)
// -----------------------------------------------------------------------------

describe("owning-layer selection", () => {
  test("variant/propensity/policyId come from the owning layer, not the attributionOnly sibling", async () => {
    const { provider } = makeProvider({
      layerIds: { flagA: "layer_a" },
      decisionFactory: () =>
        makeDecision({
          // sibling FIRST so a positional layers[0] would pick the wrong one
          assignments: { flagA: "treatment-val" },
          layers: [attributionSibling, ownerLayer],
          unitKeyValue: "u1",
        }),
    });

    const details = await provider.resolveStringEvaluation("flagA", "d", {
      targetingKey: "u1",
    });

    expect(details.value).toBe("treatment-val");
    expect(details.variant).toBe("treatment"); // owner, not sibling_control
    expect(details.reason).toBe("SPLIT");
    expect(details.flagMetadata?.["traffical.policyId"]).toBe("pol_a");
    expect(details.flagMetadata?.["traffical.propensity"]).toBe(0.5); // owner's, not 0.9
    expect(details.flagMetadata?.["traffical.decisionId"]).toBeDefined();
  });

  test("gatePropensity omits traffical.propensity", async () => {
    const { provider } = makeProvider(
      {
        layerIds: { flagA: "layer_a" },
        decisionFactory: () =>
          makeDecision({ assignments: { flagA: "v" }, layers: [ownerLayer], unitKeyValue: "u1" }),
      },
      { gatePropensity: true }
    );
    const details = await provider.resolveStringEvaluation("flagA", "d", { targetingKey: "u1" });
    expect(details.flagMetadata?.["traffical.propensity"]).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
// Type checking
// -----------------------------------------------------------------------------

describe("strict type checking", () => {
  test("resolver throws TypeMismatchError when the resolved type disagrees (no coercion)", async () => {
    const { provider } = makeProvider({
      layerIds: { flagA: "layer_a" },
      decisionFactory: () =>
        makeDecision({
          assignments: { flagA: "not-a-boolean" },
          layers: [ownerLayer],
          unitKeyValue: "u1",
        }),
    });

    await expect(
      provider.resolveBooleanEvaluation("flagA", false, { targetingKey: "u1" })
    ).rejects.toBeInstanceOf(TypeMismatchError);
  });

  test("object resolver accepts an object assignment", async () => {
    const payload = { a: 1, b: [2, 3] };
    const { provider } = makeProvider({
      layerIds: { flagO: "layer_a" },
      decisionFactory: () =>
        makeDecision({ assignments: { flagO: payload }, layers: [ownerLayer], unitKeyValue: "u1" }),
    });
    const details = await provider.resolveObjectEvaluation("flagO", {}, { targetingKey: "u1" });
    expect(details.value).toEqual(payload);
  });
});

// -----------------------------------------------------------------------------
// Exposure route
// -----------------------------------------------------------------------------

describe("exposure route", () => {
  test("store hit → trackExposure is called with the resolved decision", async () => {
    const { provider, client } = makeProvider({ layerIds: { flagA: "layer_a" } });

    await provider.runInRequest(async () => {
      const details = await provider.resolveStringEvaluation("flagA", "d", {
        targetingKey: "u1",
      });
      provider.track(EXPOSURE_EVENT_NAME, { targetingKey: "u1" }, { flagKey: "flagA" });
      expect(client.exposedDecisions).toHaveLength(1);
      expect(client.exposedDecisions[0]!.decisionId).toBe(
        details.flagMetadata?.["traffical.decisionId"]
      );
    });
  });

  test("store miss → NO trackExposure and NO decide()", async () => {
    const { provider, client } = makeProvider({ layerIds: { flagA: "layer_a" } });

    await provider.runInRequest(async () => {
      // Never resolved flagA in this request.
      provider.track(EXPOSURE_EVENT_NAME, { targetingKey: "u1" }, { flagKey: "flagA" });
    });

    expect(client.exposedDecisions).toHaveLength(0);
    expect(client.decideCalls).toHaveLength(0); // never re-decided
  });

  test("no flagKey → exposes ALL decisions stored for the request", async () => {
    const { provider, client } = makeProvider({
      layerIds: { flagA: "layer_a", flagB: "layer_a" },
    });

    await provider.runInRequest(async () => {
      await provider.resolveStringEvaluation("flagA", "d", { targetingKey: "u1" });
      await provider.resolveStringEvaluation("flagB", "d", { targetingKey: "u1" });
      provider.track(EXPOSURE_EVENT_NAME, { targetingKey: "u1" }, undefined);
    });

    expect(client.exposedDecisions).toHaveLength(2);
  });

  test("no cross-unit bleed: an exposure for unit A never stitches to unit B's decision", async () => {
    const { provider, client } = makeProvider({
      layerIds: { flagA: "layer_a", flagB: "layer_a" },
    });

    await provider.runInRequest(async () => {
      // Two identities resolved inside ONE request scope (misuse the provider
      // must still defend against — not just "by construction").
      await provider.resolveStringEvaluation("flagA", "d", { targetingKey: "userA" });
      await provider.resolveStringEvaluation("flagB", "d", { targetingKey: "userB" });

      // Exposure declares userA: must expose ONLY userA's decision (flagA),
      // never userB's — even with no flagKey (expose-all branch is filtered too).
      provider.track(EXPOSURE_EVENT_NAME, { targetingKey: "userA" }, undefined);
    });

    expect(client.exposedDecisions).toHaveLength(1);
    expect(client.exposedDecisions[0]!.metadata.unitKeyValue).toBe("userA");
  });

  test("no cross-unit bleed: flagKey hit for the wrong unit falls through to drop", async () => {
    const warn = spyOnWarn();
    const { provider, client } = makeProvider({ layerIds: { flagA: "layer_a" } });

    await provider.runInRequest(async () => {
      await provider.resolveStringEvaluation("flagA", "d", { targetingKey: "userA" });
      // Exposure for flagA but declaring userB → the stored decision is userA's,
      // so it must NOT stitch; drops + warns instead.
      provider.track(EXPOSURE_EVENT_NAME, { targetingKey: "userB" }, { flagKey: "flagA" });
    });

    expect(client.exposedDecisions).toHaveLength(0);
    expect(client.decideCalls).toHaveLength(1); // never re-decided
    warn.restore();
  });

  test("configurable exposureEventName routes to exposure", async () => {
    const { provider, client } = makeProvider(
      { layerIds: { flagA: "layer_a" } },
      { exposureEventName: "custom.exposed" }
    );
    await provider.runInRequest(async () => {
      await provider.resolveStringEvaluation("flagA", "d", { targetingKey: "u1" });
      provider.track("custom.exposed", { targetingKey: "u1" }, { flagKey: "flagA" });
    });
    expect(client.exposedDecisions).toHaveLength(1);
    expect(client.trackCalls).toHaveLength(0); // did not fall through to reward
  });

  test("fallback store (no runInRequest) still hits by unitKey+flagKey", async () => {
    const { provider, client } = makeProvider({ layerIds: { flagA: "layer_a" } });
    // No runInRequest wrapper.
    await provider.resolveStringEvaluation("flagA", "d", { targetingKey: "u1" });
    provider.track(EXPOSURE_EVENT_NAME, { targetingKey: "u1" }, { flagKey: "flagA" });
    expect(client.exposedDecisions).toHaveLength(1);
    expect(client.decideCalls).toHaveLength(1); // only the resolve decide
  });
});

// -----------------------------------------------------------------------------
// Reward route
// -----------------------------------------------------------------------------

describe("reward route", () => {
  test("always passes a unitKey and separates value from the rest", () => {
    const { provider, client } = makeProvider();
    provider.track("purchase", { targetingKey: "u1" }, { value: 99.5, orderId: "o1" });

    expect(client.trackCalls).toHaveLength(1);
    const call = client.trackCalls[0]!;
    expect(call.event).toBe("purchase");
    expect(call.options?.unitKey).toBe("u1");
    expect(call.properties?.value).toBe(99.5);
    expect(call.properties?.orderId).toBe("o1");
  });

  test("missing unit key warns and DROPS the reward (unjoinable, never shipped)", () => {
    const warn = spyOnWarn();
    const { provider, client } = makeProvider();
    provider.track("purchase", undefined, { value: 1 });
    // An empty unit key is unjoinable in the warehouse; fail loud + drop rather
    // than ship a reward that can never match a first-exposure row.
    expect(client.trackCalls).toHaveLength(0);
    expect(warn.messages.some((m) => m.includes("missing a unit key"))).toBe(true);
    warn.restore();
  });
});

// -----------------------------------------------------------------------------
// exposureOnResolve
// -----------------------------------------------------------------------------

describe("exposureOnResolve", () => {
  test("fires an exposure on each resolve", async () => {
    const { provider, client } = makeProvider(
      { layerIds: { flagA: "layer_a" } },
      { exposureOnResolve: true }
    );
    await provider.resolveStringEvaluation("flagA", "d", { targetingKey: "u1" });
    expect(client.exposedDecisions).toHaveLength(1);
  });
});

// -----------------------------------------------------------------------------
// No-exposure alarm
// -----------------------------------------------------------------------------

describe("no-exposure alarm", () => {
  test("fires once after >=20 decisions with 0 exposures (warn + non-fatal PROVIDER_ERROR)", async () => {
    const warn = spyOnWarn();
    const { provider } = makeProvider({ layerIds: { flagA: "layer_a" } });

    const errorEvents: Array<{ message?: string; errorCode?: ErrorCode }> = [];
    provider.events.addHandler(ProviderEvents.Error, (d) => {
      errorEvents.push({ message: d?.message, errorCode: d?.errorCode });
    });

    for (let i = 0; i < 25; i++) {
      await provider.resolveStringEvaluation("flagA", "d", { targetingKey: `u${i}` });
    }

    // Allow the event emitter's async handler dispatch to run.
    await Promise.resolve();

    expect(warn.messages.some((m) => m.includes("recorded") && m.includes("0 exposures"))).toBe(
      true
    );
    expect(errorEvents.length).toBeGreaterThanOrEqual(1);
    // Non-fatal: NOT PROVIDER_FATAL.
    expect(errorEvents[0]!.errorCode).not.toBe(ErrorCode.PROVIDER_FATAL);
    warn.restore();
  });

  test("does not fire when exposures are also emitted", async () => {
    const warn = spyOnWarn();
    const { provider } = makeProvider(
      { layerIds: { flagA: "layer_a" } },
      { exposureOnResolve: true }
    );
    for (let i = 0; i < 25; i++) {
      await provider.resolveStringEvaluation("flagA", "d", { targetingKey: `u${i}` });
    }
    expect(warn.messages.some((m) => m.includes("0 exposures"))).toBe(false);
    warn.restore();
  });
});

// -----------------------------------------------------------------------------
// Lifecycle
// -----------------------------------------------------------------------------

describe("lifecycle", () => {
  test("initialize awaits client.initialize and emits Ready", async () => {
    const { provider, client } = makeProvider({ withLifecycle: true });
    const ready: boolean[] = [];
    provider.events.addHandler(ProviderEvents.Ready, () => ready.push(true));

    await provider.initialize();
    await Promise.resolve();

    expect(client.initializeCalls).toBe(1);
    expect(ready.length).toBeGreaterThanOrEqual(1);
  });

  test("double initialize is a no-op", async () => {
    const { provider, client } = makeProvider({ withLifecycle: true });
    await provider.initialize();
    await provider.initialize();
    expect(client.initializeCalls).toBe(1);
  });

  test("initialize failure emits PROVIDER_ERROR with PROVIDER_FATAL and rethrows", async () => {
    const client = new StubClient();
    client.initialize = async () => {
      throw new Error("bad credentials");
    };
    const provider = new TrafficalServerProvider(client);

    const errors: Array<{ errorCode?: ErrorCode }> = [];
    provider.events.addHandler(ProviderEvents.Error, (d) => errors.push({ errorCode: d?.errorCode }));

    await expect(provider.initialize()).rejects.toThrow("bad credentials");
    await Promise.resolve();
    expect(errors.some((e) => e.errorCode === ErrorCode.PROVIDER_FATAL)).toBe(true);
  });

  test("onClose flushes then destroys, idempotently", async () => {
    const { provider, client } = makeProvider({ withLifecycle: true });
    await provider.onClose();
    await provider.onClose(); // idempotent
    expect(client.flushCalls).toBe(1);
    expect(client.destroyCalls).toBe(1);
  });

  test("initialize works when the client has no lifecycle methods", async () => {
    const { provider } = makeProvider(); // no withLifecycle
    const ready: boolean[] = [];
    provider.events.addHandler(ProviderEvents.Ready, () => ready.push(true));
    await provider.initialize();
    await provider.onClose(); // should not throw
    await Promise.resolve();
    expect(ready.length).toBeGreaterThanOrEqual(1);
  });
});

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function spyOnWarn(): { messages: string[]; restore: () => void } {
  const messages: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    messages.push(args.map((a) => String(a)).join(" "));
  };
  return {
    messages,
    restore: () => {
      console.warn = original;
    },
  };
}
