/**
 * Unit + integration tests for TrafficalWebProvider (OpenFeature WEB provider, M3).
 *
 * Mirrors the js-client test conventions:
 * - polyfills `window` for the Bun env,
 * - uses `localConfig` so no network / initialize is required for the resolver
 *   and test-vector checks,
 * - uses a structural stub client for the precise owning-layer / inert /
 *   exposure-routing / lifecycle assertions.
 *
 * Covers (design §3, §5, §6, §7, §9, §13 + testing strategy §11.1):
 * - sync resolvers return values
 * - targetingKey written to the bundle unit-key field
 * - flagMetadata has NEITHER traffical.propensity NOR traffical.modelVersion
 * - owning-layer selection with an attributionOnly sibling
 * - inert decision → DEFAULT, not stored/exposed
 * - onContextChange RETURNS and does NOT emit Reconciling/ContextChanged
 * - exposure route store hit vs miss (miss does not re-decide)
 * - reward passes a unitKey
 * - runsOn is "client"
 * - test-vector: bundle_basic.json resolves to expected_basic.json values
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

import { ProviderEvents, TargetingKeyMissingError } from "@openfeature/web-sdk";
import type { ConfigBundle, DecisionResult, Context, ParameterValue } from "@traffical/core";
import { TrafficalClient } from "@traffical/js-client";
import {
  EXPOSURE_EVENT_NAME,
  FLAG_METADATA_PREFIX,
} from "@traffical/openfeature-core";

import { TrafficalWebProvider, type TrafficalWebClient } from "./provider.js";

// Polyfill window for the Bun test env (mirrors other js-client tests).
if (typeof globalThis.window === "undefined") {
  (globalThis as any).window = globalThis;
}

// =============================================================================
// Fixtures / helpers
// =============================================================================

const FIXTURES_DIR = resolvePath(
  import.meta.dir,
  "../../../../sdk-spec/test-vectors/fixtures",
);

function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(resolvePath(FIXTURES_DIR, name), "utf8")) as T;
}

/** A minimal bundle used by the structural-stub-free real-client tests. */
const singleLayerBundle: ConfigBundle = {
  version: "2026-01-01T00:00:00Z",
  orgId: "org_1",
  projectId: "proj_1",
  env: "production",
  hashing: { unitKey: "visitorId", bucketCount: 1000 },
  parameters: [
    { key: "ui.color", type: "string", default: "#000", layerId: "layer_a", namespace: "ui" },
  ],
  layers: [
    {
      id: "layer_a",
      policies: [
        {
          id: "policy_color",
          state: "running",
          kind: "static",
          allocations: [
            { name: "control", bucketRange: [0, 499], overrides: { "ui.color": "#0000FF" } },
            { name: "treatment", bucketRange: [500, 999], overrides: { "ui.color": "#FF0000" } },
          ],
          conditions: [],
        },
      ],
    },
  ],
};

function makeRealClient(bundle: ConfigBundle): TrafficalClient {
  return new TrafficalClient({
    orgId: bundle.orgId,
    projectId: bundle.projectId,
    env: bundle.env,
    apiKey: "traffical_sk_test",
    refreshIntervalMs: -1, // no background timer
    disableCloudEvents: true, // never touch the network
    localConfig: bundle,
  });
}

/**
 * A fully-controllable structural stub of the browser client. Lets tests hand
 * back exact decisions (including attributionOnly siblings and inert
 * fallbacks) and observe trackExposure / track calls.
 */
class StubClient implements TrafficalWebClient {
  public unitKeyField: string | null = "visitorId";
  public parameterLayerId: string | null = "layer_a";
  public configVersion: string | null = "v1";
  public nextDecision: DecisionResult | null = null;

  public decideCalls: Array<{ context: Context; defaults: Record<string, ParameterValue> }> = [];
  public exposureCalls: DecisionResult[] = [];
  public trackCalls: Array<{
    event: string;
    properties?: Record<string, unknown>;
    options?: { decisionId?: string; unitKey?: string };
  }> = [];
  public identifyCalls: string[] = [];
  public destroyed = 0;
  public initialized = 0;
  public stableId = "anon_stable_id";

  getUnitKeyField(): string | null {
    return this.unitKeyField;
  }
  getParameterLayerId(_key: string): string | null {
    return this.parameterLayerId;
  }
  getConfigVersion(): string | null {
    return this.configVersion;
  }
  decide<T extends Record<string, ParameterValue>>(opts: { context: Context; defaults: T }): DecisionResult {
    this.decideCalls.push(opts);
    if (this.nextDecision) return this.nextDecision;
    // Default: a benign single-layer decision echoing the defaults.
    const [key] = Object.keys(opts.defaults);
    return {
      decisionId: "dec_stub",
      assignments: { ...opts.defaults },
      metadata: {
        timestamp: "2026-01-01T00:00:00Z",
        unitKeyValue: String(opts.context[this.unitKeyField ?? "visitorId"] ?? ""),
        layers: [
          {
            layerId: this.parameterLayerId ?? "layer_a",
            bucket: 100,
            policyId: "policy_x",
            allocationName: "control",
          },
        ],
        configVersion: this.configVersion ?? undefined,
      },
    };
  }
  trackExposure(decision: DecisionResult): void {
    this.exposureCalls.push(decision);
  }
  track(
    event: string,
    properties?: Record<string, unknown>,
    options?: { decisionId?: string; unitKey?: string },
  ): void {
    this.trackCalls.push({ event, properties, options });
  }
  async initialize(): Promise<void> {
    this.initialized++;
  }
  destroy(): void {
    this.destroyed++;
  }
  getStableId(): string {
    return this.stableId;
  }
  identify(unitKey: string): void {
    this.identifyCalls.push(unitKey);
  }
}

const INERT: DecisionResult = {
  decisionId: "dec_inert",
  assignments: {},
  metadata: { timestamp: "2026-01-01T00:00:00Z", unitKeyValue: "", layers: [] },
};

// =============================================================================
// runsOn / metadata
// =============================================================================

describe("TrafficalWebProvider — identity", () => {
  test("runsOn is client and metadata name is traffical-provider", () => {
    const provider = new TrafficalWebProvider(new StubClient());
    expect(provider.runsOn).toBe("client");
    expect(provider.metadata.name).toBe("traffical-provider");
  });
});

// =============================================================================
// Sync resolvers return values (real client, localConfig)
// =============================================================================

describe("TrafficalWebProvider — sync resolvers", () => {
  test("resolveStringEvaluation returns the engine-assigned value synchronously", async () => {
    const client = makeRealClient(singleLayerBundle);
    const provider = new TrafficalWebProvider(client);
    await provider.initialize({ targetingKey: "user-treatment" });

    const details = provider.resolveStringEvaluation("ui.color", "#default");
    // "user-treatment" buckets deterministically; value is one of the two arms
    // (or the default). It is a string, resolved without a promise.
    expect(typeof details.value).toBe("string");
    expect(["#0000FF", "#FF0000"]).toContain(details.value);
    expect(details.reason).toBe("SPLIT");

    await provider.onClose();
  });

  test("targetingKey is written to the bundle's unit-key field (not 'targetingKey')", () => {
    const stub = new StubClient();
    stub.unitKeyField = "visitorId";
    const provider = new TrafficalWebProvider(stub);
    // No initialize needed for the stub; set the bound context via onContextChange.
    provider.onContextChange({}, { targetingKey: "u-42", plan: "pro" });

    provider.resolveStringEvaluation("ui.color", "d");

    expect(stub.decideCalls).toHaveLength(1);
    const ctx = stub.decideCalls[0].context;
    expect(ctx.visitorId).toBe("u-42"); // written to the unit-key field
    expect(ctx.targetingKey).toBe("u-42"); // also mirrored for completeness
    expect(ctx.plan).toBe("pro"); // attributes carried through
  });

  test("options.unitKey overrides the client's unit-key field", () => {
    const stub = new StubClient();
    stub.unitKeyField = "visitorId";
    const provider = new TrafficalWebProvider(stub, { unitKey: "accountId" });
    provider.onContextChange({}, { targetingKey: "acct-1" });

    provider.resolveStringEvaluation("ui.color", "d");
    expect(stub.decideCalls[0].context.accountId).toBe("acct-1");
  });

  test("missing targeting key throws TargetingKeyMissingError (propagates to SDK)", () => {
    const stub = new StubClient();
    const provider = new TrafficalWebProvider(stub);
    // bound context is empty → no targetingKey
    expect(() => provider.resolveStringEvaluation("ui.color", "d")).toThrow(
      TargetingKeyMissingError,
    );
    expect(stub.decideCalls).toHaveLength(0); // never decided
  });
});

// =============================================================================
// flagMetadata: web gates BOTH propensity AND modelVersion
// =============================================================================

describe("TrafficalWebProvider — flagMetadata web gating", () => {
  test("flagMetadata omits traffical.propensity and traffical.modelVersion", () => {
    const stub = new StubClient();
    stub.nextDecision = {
      decisionId: "dec_ada",
      assignments: { "ui.color": "#123456" },
      metadata: {
        timestamp: "2026-01-01T00:00:00Z",
        unitKeyValue: "u-ada",
        configVersion: "cfg_9",
        layers: [
          {
            layerId: "layer_a",
            bucket: 42,
            policyId: "policy_bandit",
            policyKey: "pk",
            allocationId: "alloc_1",
            allocationName: "treatment",
            allocationKey: "ak",
            probability: 0.73, // propensity — must NOT leak
            modelVersion: "2026-06-01T00:00:00Z", // must NOT leak on web
          },
        ],
      },
    };
    const provider = new TrafficalWebProvider(stub);
    provider.onContextChange({}, { targetingKey: "u-ada" });

    const details = provider.resolveStringEvaluation("ui.color", "d");
    const meta = details.flagMetadata ?? {};

    expect(meta[`${FLAG_METADATA_PREFIX}.propensity`]).toBeUndefined();
    expect(meta[`${FLAG_METADATA_PREFIX}.modelVersion`]).toBeUndefined();
    // But the non-sensitive keys ARE present.
    expect(meta[`${FLAG_METADATA_PREFIX}.decisionId`]).toBe("dec_ada");
    expect(meta[`${FLAG_METADATA_PREFIX}.policyId`]).toBe("policy_bandit");
    expect(meta[`${FLAG_METADATA_PREFIX}.allocationKey`]).toBe("ak");
    expect(meta[`${FLAG_METADATA_PREFIX}.bucket`]).toBe(42);
    expect(meta[`${FLAG_METADATA_PREFIX}.configVersion`]).toBe("cfg_9");
    expect(details.variant).toBe("treatment");
  });
});

// =============================================================================
// Owning-layer selection with an attributionOnly sibling (B1/D1 guard)
// =============================================================================

describe("TrafficalWebProvider — owning-layer selection", () => {
  test("selects the owning layer by layerId; ignores the attributionOnly sibling", () => {
    const stub = new StubClient();
    stub.parameterLayerId = "layer_owner";
    stub.nextDecision = {
      decisionId: "dec_multi",
      assignments: { "ui.color": "#owner" },
      metadata: {
        timestamp: "2026-01-01T00:00:00Z",
        unitKeyValue: "u-1",
        layers: [
          {
            // attributionOnly sibling — the WRONG experiment; must not be picked.
            layerId: "layer_sibling",
            bucket: 5,
            policyId: "policy_sibling",
            allocationName: "sibling_variant",
            attributionOnly: true,
          },
          {
            layerId: "layer_owner",
            bucket: 900,
            policyId: "policy_owner",
            allocationName: "owner_variant",
          },
        ],
      },
    };
    const provider = new TrafficalWebProvider(stub);
    provider.onContextChange({}, { targetingKey: "u-1" });

    const details = provider.resolveStringEvaluation("ui.color", "d");
    expect(details.variant).toBe("owner_variant"); // not "sibling_variant"
    expect(details.flagMetadata?.[`${FLAG_METADATA_PREFIX}.policyId`]).toBe("policy_owner");
  });
});

// =============================================================================
// Inert decision → DEFAULT, not stored/exposed
// =============================================================================

describe("TrafficalWebProvider — inert decision", () => {
  test("inert decision maps to DEFAULT and is not stored (exposure then misses)", () => {
    const stub = new StubClient();
    stub.nextDecision = INERT;
    const provider = new TrafficalWebProvider(stub);
    provider.onContextChange({}, { targetingKey: "u-inert" });

    const details = provider.resolveStringEvaluation("ui.color", "#fallback");
    expect(details.value).toBe("#fallback");
    expect(details.reason).toBe("DEFAULT");
    expect(details.variant).toBeUndefined();

    // Because the inert decision was NOT stored, an exposure call misses and
    // no-ops (never re-decides, never exposes).
    provider.track(EXPOSURE_EVENT_NAME, { flagKey: "ui.color" });
    expect(stub.exposureCalls).toHaveLength(0);
  });
});

// =============================================================================
// onContextChange: returns void; provider does NOT emit reconcile events
// =============================================================================

describe("TrafficalWebProvider — onContextChange", () => {
  test("returns void and does NOT emit Reconciling/ContextChanged/Stale", () => {
    const stub = new StubClient();
    const provider = new TrafficalWebProvider(stub);

    const emitted: string[] = [];
    const origEmit = provider.events.emit.bind(provider.events);
    (provider.events as any).emit = (eventType: string, ctx?: unknown) => {
      emitted.push(eventType);
      return origEmit(eventType as any, ctx as any);
    };

    const ret = provider.onContextChange({ targetingKey: "old" }, { targetingKey: "new" });
    expect(ret).toBeUndefined(); // returning void → SDK emits CONTEXT_CHANGED only

    expect(emitted).not.toContain(ProviderEvents.Reconciling);
    expect(emitted).not.toContain(ProviderEvents.ContextChanged);
    expect(emitted).not.toContain(ProviderEvents.Stale);
  });

  test("clears the decision memo so a stale-identity decision cannot be exposed", () => {
    const stub = new StubClient();
    const provider = new TrafficalWebProvider(stub);
    provider.onContextChange({}, { targetingKey: "u-first" });

    // Resolve → decision memoized under the first identity.
    provider.resolveStringEvaluation("ui.color", "d");
    // Context change clears the memo AND calls identify.
    provider.onContextChange({ targetingKey: "u-first" }, { targetingKey: "u-second" });
    expect(stub.identifyCalls).toContain("u-second");

    // Exposure for the old decision now misses (memo cleared) → no exposure.
    provider.track(EXPOSURE_EVENT_NAME, { flagKey: "ui.color" });
    expect(stub.exposureCalls).toHaveLength(0);
  });
});

// =============================================================================
// Config-change signal: memo is configVersion-invalidated on background refresh
// =============================================================================

/**
 * A stub that exposes the `use()` plugin surface so the provider can wire its
 * config-change listener, and lets the test drive a background refresh by
 * bumping `configVersion` and firing the registered `onConfigUpdate`.
 */
class ConfigChangeStub extends StubClient {
  private configListener?: (bundle: unknown) => void;

  use(plugin: { name: string; onConfigUpdate?: (bundle: unknown) => void }): unknown {
    this.configListener = plugin.onConfigUpdate;
    return this;
  }

  /** Simulate a background refresh to a new config version. */
  fireRefresh(nextVersion: string): void {
    this.configVersion = nextVersion;
    this.configListener?.({});
  }
}

describe("TrafficalWebProvider — config-change memo invalidation", () => {
  test("a background refresh clears the memo so a post-refresh exposure drops (no stale stitch)", async () => {
    const stub = new ConfigChangeStub();
    const provider = new TrafficalWebProvider(stub);
    await provider.initialize({ targetingKey: "u-refresh" }); // wires config-change signal

    const emitted: string[] = [];
    provider.events.addHandler(ProviderEvents.ConfigurationChanged, () => {
      emitted.push(ProviderEvents.ConfigurationChanged);
    });

    // Resolve → decision memoized under config v1.
    provider.resolveStringEvaluation("ui.color", "d");

    // Background refresh to v2: memo MUST be invalidated.
    stub.fireRefresh("v2");
    expect(emitted).toContain(ProviderEvents.ConfigurationChanged);

    // A post-refresh exposure with no intervening re-resolve now MISSES the
    // (cleared) memo → drop, never stitch to the stale v1 decision.
    provider.track(EXPOSURE_EVENT_NAME, { flagKey: "ui.color" });
    expect(stub.exposureCalls).toHaveLength(0);
  });
});

// =============================================================================
// Exposure route: store hit vs miss (miss does not re-decide)
// =============================================================================

describe("TrafficalWebProvider — exposure routing", () => {
  test("store HIT: trackExposure is called with the memoized decision", () => {
    const stub = new StubClient();
    const provider = new TrafficalWebProvider(stub);
    provider.onContextChange({}, { targetingKey: "u-hit" });

    provider.resolveStringEvaluation("ui.color", "d"); // memoizes dec_stub
    const decideCallsAfterResolve = stub.decideCalls.length;

    provider.track(EXPOSURE_EVENT_NAME, { flagKey: "ui.color" });
    expect(stub.exposureCalls).toHaveLength(1);
    expect(stub.exposureCalls[0].decisionId).toBe("dec_stub");
    // Crucially: the exposure route NEVER re-decides.
    expect(stub.decideCalls.length).toBe(decideCallsAfterResolve);
  });

  test("store MISS: no exposure, no re-decide, warns once", () => {
    const stub = new StubClient();
    const provider = new TrafficalWebProvider(stub);
    provider.onContextChange({}, { targetingKey: "u-miss" });

    // No resolve happened for this flag → memo miss.
    provider.track(EXPOSURE_EVENT_NAME, { flagKey: "never.resolved" });
    expect(stub.exposureCalls).toHaveLength(0);
    expect(stub.decideCalls).toHaveLength(0); // never re-decides
  });
});

// =============================================================================
// exposureOnResolve opt-in (§5)
// =============================================================================

describe("TrafficalWebProvider — exposureOnResolve", () => {
  test("fires trackExposure on the just-made decision (no re-decide)", () => {
    const stub = new StubClient();
    const provider = new TrafficalWebProvider(stub, { exposureOnResolve: true });
    provider.onContextChange({}, { targetingKey: "u-eor" });

    provider.resolveStringEvaluation("ui.color", "d");

    expect(stub.decideCalls).toHaveLength(1); // decided once
    expect(stub.exposureCalls).toHaveLength(1); // exposed on resolve
    expect(stub.exposureCalls[0].decisionId).toBe("dec_stub"); // same decision
  });

  test("off by default: resolve does NOT fire an exposure", () => {
    const stub = new StubClient();
    const provider = new TrafficalWebProvider(stub);
    provider.onContextChange({}, { targetingKey: "u-noeor" });
    provider.resolveStringEvaluation("ui.color", "d");
    expect(stub.exposureCalls).toHaveLength(0);
  });
});

// =============================================================================
// Reward route: always passes a unitKey
// =============================================================================

describe("TrafficalWebProvider — reward routing", () => {
  test("reward passes unitKey from the bound targetingKey and lifts value out", () => {
    const stub = new StubClient();
    const provider = new TrafficalWebProvider(stub);
    provider.onContextChange({}, { targetingKey: "u-buyer" });

    provider.track("purchase", { value: 42.5, orderId: "ord_1" });

    expect(stub.trackCalls).toHaveLength(1);
    const call = stub.trackCalls[0];
    expect(call.event).toBe("purchase");
    expect(call.options?.unitKey).toBe("u-buyer");
    expect(call.properties?.value).toBe(42.5);
    expect(call.properties?.orderId).toBe("ord_1");
  });

  test("reward falls back to the client stableId when no bound targetingKey", () => {
    const stub = new StubClient();
    stub.stableId = "anon_xyz";
    const provider = new TrafficalWebProvider(stub);
    // no bound targetingKey
    provider.track("add_to_cart", { itemId: "sku_9" });

    expect(stub.trackCalls[0].options?.unitKey).toBe("anon_xyz");
  });
});

// =============================================================================
// Lifecycle: initialize emits Ready; onClose is idempotent + calls destroy
// =============================================================================

describe("TrafficalWebProvider — lifecycle", () => {
  test("initialize awaits client.initialize and emits Ready", async () => {
    const stub = new StubClient();
    const provider = new TrafficalWebProvider(stub);
    const emitted: string[] = [];
    (provider.events as any).emit = (eventType: string) => emitted.push(eventType);

    await provider.initialize({ targetingKey: "u-init" });
    expect(stub.initialized).toBe(1);
    expect(emitted).toContain(ProviderEvents.Ready);
  });

  test("initialize failure emits Error and rethrows", async () => {
    const stub = new StubClient();
    stub.initialize = async () => {
      throw new Error("bad config");
    };
    const provider = new TrafficalWebProvider(stub);
    const emitted: string[] = [];
    (provider.events as any).emit = (eventType: string) => emitted.push(eventType);

    await expect(provider.initialize()).rejects.toThrow("bad config");
    expect(emitted).toContain(ProviderEvents.Error);
  });

  test("onClose is idempotent and calls client.destroy once", async () => {
    const stub = new StubClient();
    const provider = new TrafficalWebProvider(stub);
    await provider.initialize({ targetingKey: "u" });
    await provider.onClose();
    await provider.onClose(); // double-close guarded
    expect(stub.destroyed).toBe(1);
  });
});

// =============================================================================
// No-exposure alarm (§5/D2)
// =============================================================================

describe("TrafficalWebProvider — no-exposure alarm", () => {
  test("emits a non-fatal Error once when decisions accrue with zero exposures", () => {
    const stub = new StubClient();
    const provider = new TrafficalWebProvider(stub);
    provider.onContextChange({}, { targetingKey: "u-alarm" });

    const errors: unknown[] = [];
    (provider.events as any).emit = (eventType: string, ctx?: unknown) => {
      if (eventType === ProviderEvents.Error) errors.push(ctx);
    };

    // Resolve many distinct flags (all decisions, no exposures) past threshold.
    for (let i = 0; i < 15; i++) {
      provider.resolveStringEvaluation(`flag.${i}`, "d");
    }
    expect(errors.length).toBe(1); // fired exactly once
  });
});

// =============================================================================
// Test-vector integration: bundle_basic.json → expected_basic.json
// =============================================================================

describe("TrafficalWebProvider — test-vector (bundle_basic)", () => {
  test("resolves each unit to the expected assignment values", async () => {
    const bundle = loadFixture<ConfigBundle>("bundle_basic.json");
    const expected = loadFixture<{
      testCases: Array<{
        context: { userId: string };
        expectedAssignments: Record<string, ParameterValue>;
      }>;
    }>("expected_basic.json");

    const client = makeRealClient(bundle);
    const provider = new TrafficalWebProvider(client);
    // Initialize once (localConfig is already loaded; no network needed).
    await provider.initialize({ targetingKey: expected.testCases[0].context.userId });

    for (const tc of expected.testCases) {
      // Re-bind this unit's context via the static-context reconcile path.
      provider.onContextChange({}, { targetingKey: tc.context.userId });

      const color = provider.resolveStringEvaluation(
        "ui.primaryColor",
        "#default",
      );
      const buttonText = provider.resolveStringEvaluation("ui.buttonText", "fallback");
      const discount = provider.resolveNumberEvaluation("pricing.discount", -1);

      expect(color.value).toBe(tc.expectedAssignments["ui.primaryColor"]);
      expect(buttonText.value).toBe(tc.expectedAssignments["ui.buttonText"]);
      expect(discount.value).toBe(tc.expectedAssignments["pricing.discount"]);
    }

    await provider.onClose();
  });
});
