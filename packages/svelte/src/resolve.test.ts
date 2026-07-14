/**
 * @traffical/svelte - CSR resolution regression tests
 *
 * These cover the client-side-rendering bug where a provider mounted WITHOUT an
 * `initialBundle` stranded resolved params at their defaults: the hook gated
 * resolution on a locally-tracked `bundle` that started null and was never
 * updated after the client's fetch. The fix trusts `client.getParams` once a
 * client exists (see computeParamsFrom) and the provider now keeps `bundle` in
 * sync via the client's onConfigUpdate hook.
 */

import { describe, test, expect } from "bun:test";
import { resolveParameters } from "@traffical/core";
import type { ConfigBundle, Context, ParameterValue } from "@traffical/core";
import type { TrafficalClient } from "@traffical/js-client";
import { computeParamsFrom, computeDecisionFrom } from "./resolve.js";

const bundle: ConfigBundle = {
  version: "2026-07-01T00:00:00Z",
  orgId: "org_test",
  projectId: "proj_test",
  env: "test",
  hashing: { unitKey: "userId", bucketCount: 10000 },
  parameters: [
    {
      key: "checkout.ctaText",
      type: "string",
      default: "Buy Now",
      layerId: "layer_1",
      namespace: "checkout",
    },
  ],
  layers: [
    {
      id: "layer_1",
      policies: [
        {
          id: "policy_1",
          state: "running",
          kind: "static",
          conditions: [],
          allocations: [
            {
              id: "alloc_1",
              name: "treatment",
              bucketRange: [0, 9999] as [number, number],
              overrides: { "checkout.ctaText": "Get Started" },
            },
          ],
        },
      ],
    },
  ],
  domBindings: [],
};

/**
 * A minimal TrafficalClient stub whose config lands asynchronously. Before the
 * "fetch" it holds no bundle (getParams echoes defaults); after `landConfig()`
 * it resolves against the real bundle — exactly what the browser client does.
 */
function createDeferredClient() {
  let loaded: ConfigBundle | null = null;
  const stub = {
    getParams<T extends Record<string, ParameterValue>>(opts: {
      context: Context;
      defaults: T;
    }): T {
      if (!loaded) return opts.defaults;
      return resolveParameters(loaded, opts.context, opts.defaults);
    },
    decide<T extends Record<string, ParameterValue>>(opts: {
      context: Context;
      defaults: T;
    }) {
      const assignments = this.getParams(opts);
      return {
        decisionId: loaded ? "dec_1" : "dec_inert",
        assignments,
        values: assignments,
        metadata: {
          unitKeyValue: loaded ? "user_1" : "",
          layers: loaded ? [{ layerId: "layer_1", bucket: 0 }] : [],
        },
      } as unknown as ReturnType<TrafficalClient["decide"]>;
    },
  };
  return {
    client: stub as unknown as TrafficalClient,
    landConfig: () => {
      loaded = bundle;
    },
  };
}

describe("CSR provider without initialBundle", () => {
  test("resolves params after fetch (bundle gate dropped)", () => {
    const { client, landConfig } = createDeferredClient();
    const getContext = (): Context => ({ userId: "user_1" });
    const defaults = { "checkout.ctaText": "Buy Now" };

    // Cold start: no initialBundle → the provider's tracked bundle is null and
    // the client has not fetched yet. Params fall back to defaults.
    const before = computeParamsFrom(
      { client, bundle: null, getContext },
      { defaults }
    );
    expect(before["checkout.ctaText"]).toBe("Buy Now");

    // The client's config lands (first fetch). CRUCIALLY the provider's tracked
    // `bundle` is STILL null in this call — resolution must trust the client.
    landConfig();
    const after = computeParamsFrom(
      { client, bundle: null, getContext },
      { defaults }
    );
    expect(after["checkout.ctaText"]).toBe("Get Started");
  });

  test("decision is null until config lands, then non-inert", () => {
    const { client, landConfig } = createDeferredClient();
    const getContext = (): Context => ({ userId: "user_1" });
    const defaults = { "checkout.ctaText": "Buy Now" };

    // No bundle yet → no decision emitted (avoids a defaults-only decision).
    const before = computeDecisionFrom(
      { client, bundle: null, getContext },
      { defaults, shouldTrackDecision: true }
    );
    expect(before).toBeNull();

    // Once the provider tracks the landed bundle, a real decision is produced.
    landConfig();
    const after = computeDecisionFrom(
      { client, bundle, getContext },
      { defaults, shouldTrackDecision: true }
    );
    expect(after).not.toBeNull();
    expect(after?.assignments["checkout.ctaText"]).toBe("Get Started");
  });

  test("no client, no bundle → initialParams then defaults", () => {
    const getContext = (): Context => ({ userId: "user_1" });
    const defaults = { "checkout.ctaText": "Buy Now" };

    const withInitial = computeParamsFrom(
      { client: null, bundle: null, initialParams: { "checkout.ctaText": "SSR" }, getContext },
      { defaults }
    );
    expect(withInitial["checkout.ctaText"]).toBe("SSR");

    const bare = computeParamsFrom(
      { client: null, bundle: null, getContext },
      { defaults }
    );
    expect(bare["checkout.ctaText"]).toBe("Buy Now");
  });
});
