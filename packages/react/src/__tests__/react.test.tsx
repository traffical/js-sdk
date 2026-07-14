/**
 * @traffical/react — Provider + hook behavior suite.
 *
 * Renders the real TrafficalProvider/useTraffical against a `localConfig`
 * bundle (offline: the init fetch points at loopback and fails, the client
 * falls back to localConfig). Events are captured via a BYO `eventLogger` with
 * `disableCloudEvents`, so we assert observable behavior (decision/exposure/
 * track emission, once-per-decision, pending-track flush, teardown, identity
 * re-resolve) without any network.
 */

import React, { useEffect } from "react";
import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import { render, screen, cleanup, act, waitFor } from "@testing-library/react";
import type { ConfigBundle, TrackableEvent } from "@traffical/core";
import type { TrafficalPlugin } from "@traffical/js-client";
import { TrafficalProvider } from "../provider.js";
import { useTraffical, useTrafficalClient } from "../hooks.js";

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

const baseConfig = {
  orgId: "org_test",
  projectId: "proj_test",
  env: "test",
  apiKey: "pk_test",
  baseUrl: "http://127.0.0.1:1", // loopback → init fetch fails offline
  refreshIntervalMs: -1,
  disableCloudEvents: true,
  localConfig: bundle,
  unitKeyFn: () => "user_alice",
};

function makeCapture() {
  const events: TrackableEvent[] = [];
  const eventLogger = (e: TrackableEvent) => {
    events.push(e);
  };
  return {
    events,
    eventLogger,
    ofType: (t: TrackableEvent["type"]) => events.filter((e) => e.type === t),
  };
}

beforeEach(() => {
  // Fresh localStorage per test so stable-id / exposure-dedup don't bleed.
  try {
    localStorage.clear();
  } catch {
    /* no-op */
  }
});

afterEach(() => {
  cleanup();
});

function Cta({ tracking }: { tracking?: "full" | "decision" | "none" }) {
  const { params, ready } = useTraffical({
    defaults: { "checkout.ctaText": "Buy Now" },
    tracking,
  });
  return (
    <div>
      <span data-testid="cta">{params["checkout.ctaText"]}</span>
      <span data-testid="ready">{String(ready)}</span>
    </div>
  );
}

describe("@traffical/react provider + hooks", () => {
  test("resolves synchronously from localConfig (no default flicker)", async () => {
    const cap = makeCapture();
    render(
      <TrafficalProvider config={{ ...baseConfig, eventLogger: cap.eventLogger }}>
        <Cta tracking="none" />
      </TrafficalProvider>
    );
    // First paint already shows the resolved value, not the default.
    expect(screen.getByTestId("cta").textContent).toBe("Get Started");
    await waitFor(() =>
      expect(screen.getByTestId("ready").textContent).toBe("true")
    );
  });

  test('tracking "none" emits no decision or exposure', async () => {
    const cap = makeCapture();
    render(
      <TrafficalProvider config={{ ...baseConfig, eventLogger: cap.eventLogger }}>
        <Cta tracking="none" />
      </TrafficalProvider>
    );
    await waitFor(() =>
      expect(screen.getByTestId("ready").textContent).toBe("true")
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(cap.ofType("decision")).toHaveLength(0);
    expect(cap.ofType("exposure")).toHaveLength(0);
  });

  test('tracking "decision" emits a decision but no auto-exposure', async () => {
    const cap = makeCapture();
    render(
      <TrafficalProvider config={{ ...baseConfig, eventLogger: cap.eventLogger }}>
        <Cta tracking="decision" />
      </TrafficalProvider>
    );
    await waitFor(() => expect(cap.ofType("decision").length).toBeGreaterThan(0));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(cap.ofType("exposure")).toHaveLength(0);
  });

  test('tracking "full" emits a decision and exactly one exposure', async () => {
    const cap = makeCapture();
    render(
      <TrafficalProvider config={{ ...baseConfig, eventLogger: cap.eventLogger }}>
        <Cta tracking="full" />
      </TrafficalProvider>
    );
    await waitFor(() => expect(cap.ofType("exposure").length).toBe(1));
    // Re-render churn must not double-fire exposure for the same decision.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(cap.ofType("exposure")).toHaveLength(1);
    expect(cap.ofType("decision").length).toBeGreaterThan(0);
  });

  test("pending track() before the decision is ready is queued then flushed", async () => {
    const cap = makeCapture();

    function EarlyTracker() {
      const { track } = useTraffical({
        defaults: { "checkout.ctaText": "Buy Now" },
        tracking: "full",
      });
      // Fires during the initial commit, before the decide effect has set the
      // decision — exercises the pending-track queue + flush-on-decision path.
      useEffect(() => {
        track("early_click", { source: "test" });
      }, [track]);
      return null;
    }

    render(
      <TrafficalProvider config={{ ...baseConfig, eventLogger: cap.eventLogger }}>
        <EarlyTracker />
      </TrafficalProvider>
    );

    await waitFor(() => {
      const tracks = cap.ofType("track");
      expect(tracks.some((e) => (e as { event?: string }).event === "early_click")).toBe(true);
    });
  });

  test("calls client teardown on unmount (plugin onDestroy)", async () => {
    let destroyed = false;
    const teardownPlugin: TrafficalPlugin = {
      name: "test-teardown",
      onDestroy: () => {
        destroyed = true;
      },
    };
    const cap = makeCapture();
    const { unmount } = render(
      <TrafficalProvider
        config={{ ...baseConfig, eventLogger: cap.eventLogger, plugins: [teardownPlugin] }}
      >
        <Cta tracking="none" />
      </TrafficalProvider>
    );
    await waitFor(() =>
      expect(screen.getByTestId("ready").textContent).toBe("true")
    );
    act(() => {
      unmount();
    });
    expect(destroyed).toBe(true);
  });

  test("resolves correctly under StrictMode (double mount/unmount)", async () => {
    const cap = makeCapture();
    render(
      <React.StrictMode>
        <TrafficalProvider config={{ ...baseConfig, eventLogger: cap.eventLogger }}>
          <Cta tracking="full" />
        </TrafficalProvider>
      </React.StrictMode>
    );
    expect(screen.getByTestId("cta").textContent).toBe("Get Started");
    await waitFor(() =>
      expect(screen.getByTestId("ready").textContent).toBe("true")
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    // Exposure dedup (persisted per session) keeps StrictMode's remount from
    // multiplying exposures for the same unit+variant.
    expect(cap.ofType("exposure").length).toBeLessThanOrEqual(1);
  });

  test("re-resolves on identity change (fires exposure for the new unit)", async () => {
    const cap = makeCapture();

    function Grabber({ onClient }: { onClient: (c: unknown) => void }) {
      const { client, ready } = useTrafficalClient();
      useEffect(() => {
        if (ready && client) onClient(client);
      }, [ready, client, onClient]);
      return null;
    }

    let captured: { identify: (k: string) => void } | null = null;
    render(
      <TrafficalProvider config={{ ...baseConfig, eventLogger: cap.eventLogger }}>
        <Cta tracking="full" />
        <Grabber onClient={(c) => (captured = c as { identify: (k: string) => void })} />
      </TrafficalProvider>
    );

    // First identity (user_alice) → exactly one exposure.
    await waitFor(() => expect(cap.ofType("exposure").length).toBe(1));

    await act(async () => {
      captured?.identify("user_bob");
      await new Promise((r) => setTimeout(r, 30));
    });

    // Identity change must trigger a re-decode → a fresh exposure for the new
    // unit (exposure dedup is keyed by unit+variant, so user_bob is not deduped
    // against user_alice). Decision-event dedup can collapse the same-variant
    // decision, so exposure is the robust signal that a re-resolve happened.
    await waitFor(() => expect(cap.ofType("exposure").length).toBe(2));
    const units = cap
      .ofType("exposure")
      .map((e) => (e as { unitKey?: string }).unitKey);
    expect(units).toContain("user_alice");
    expect(units).toContain("user_bob");
  });
});
