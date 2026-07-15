/**
 * Canonical option-name aliases (spec 0.7.0 sdk-design-contract).
 *
 * The Node client accepts the canonical option names alongside the legacy
 * ones, and a specific canonical option always wins when both are set:
 *   - batchSize            (alias of eventBatchSize)
 *   - flushIntervalMs      (alias of eventFlushIntervalMs)
 *   - configTimeoutMs / eventsTimeoutMs / resolveTimeoutMs
 *       (per-path split of the legacy single requestTimeoutMs)
 */
import { describe, test, expect, afterEach, mock } from "bun:test";
import { TrafficalClient } from "./client.js";
import type { ConfigBundle } from "@traffical/core";

const originalFetch = globalThis.fetch;
const originalWarn = console.warn;

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.warn = originalWarn;
});

const localConfig = {
  version: "2024-06-01T00:00:00.000Z",
  orgId: "org_1",
  projectId: "proj_1",
  env: "test",
  hashing: { unitKey: "userId", bucketCount: 1000 },
  parameters: [
    { key: "ui.color", type: "string", default: "#000", layerId: "layer_ui", namespace: "ui" },
  ],
  layers: [],
} as unknown as ConfigBundle;

function baseOpts() {
  return {
    orgId: "org_1",
    projectId: "proj_1",
    env: "test",
    apiKey: "pk",
    localConfig,
    refreshIntervalMs: -1,
    trackDecisions: false,
    // Never auto-flush on a timer unless a test overrides it.
    eventFlushIntervalMs: 999999,
    flushIntervalMs: 999999,
  };
}

/** Mock fetch that records the /v1/events/batch POST bodies (config routes 404). */
function mockEventPosts(posted: unknown[][]) {
  globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
    if (String(url).includes("/v1/events/batch")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      posted.push(body.events);
      return new Response(JSON.stringify({ accepted: 1 }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("batchSize alias", () => {
  test("canonical batchSize triggers auto-flush at the threshold", async () => {
    const posted: unknown[][] = [];
    mockEventPosts(posted);
    const client = new TrafficalClient({ ...baseOpts(), batchSize: 1 });
    await client.initialize();
    client.track("purchase", { orderId: "o1" }, { unitKey: "user-1" });
    await tick();
    expect(posted.flat().length).toBeGreaterThan(0);
    await client.close();
  });

  test("legacy eventBatchSize still triggers auto-flush at the threshold", async () => {
    const posted: unknown[][] = [];
    mockEventPosts(posted);
    const client = new TrafficalClient({ ...baseOpts(), eventBatchSize: 1 });
    await client.initialize();
    client.track("purchase", { orderId: "o1" }, { unitKey: "user-1" });
    await tick();
    expect(posted.flat().length).toBeGreaterThan(0);
    await client.close();
  });

  test("canonical batchSize wins over legacy eventBatchSize", async () => {
    const posted: unknown[][] = [];
    mockEventPosts(posted);
    // Canonical=1 (flush after 1) beats legacy=1000 (would never flush here).
    const client = new TrafficalClient({ ...baseOpts(), batchSize: 1, eventBatchSize: 1000 });
    await client.initialize();
    client.track("purchase", { orderId: "o1" }, { unitKey: "user-1" });
    await tick();
    expect(posted.flat().length).toBeGreaterThan(0);
    await client.close();
  });
});

describe("flushIntervalMs alias", () => {
  test("canonical flushIntervalMs wins over legacy eventFlushIntervalMs", async () => {
    const posted: unknown[][] = [];
    mockEventPosts(posted);
    // Canonical=10ms flushes on the timer; legacy=999999 would not within the window.
    const client = new TrafficalClient({
      ...baseOpts(),
      flushIntervalMs: 10,
      eventFlushIntervalMs: 999999,
      batchSize: 1000, // keep batch threshold high so only the timer can flush
    });
    await client.initialize();
    client.track("purchase", { orderId: "o1" }, { unitKey: "user-1" });
    await new Promise((r) => setTimeout(r, 60));
    expect(posted.flat().length).toBeGreaterThan(0);
    await client.close();
  });
});

/** A fetch that hangs forever but rejects with AbortError when aborted. */
function mockHungFetch(capture: (url: string, signal: AbortSignal | null | undefined) => void) {
  globalThis.fetch = mock(
    (url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        capture(String(url), init?.signal);
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      })
  ) as unknown as typeof fetch;
}

describe("configTimeoutMs alias", () => {
  test("canonical configTimeoutMs aborts a hung config fetch (canonical wins over legacy)", async () => {
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
    let configSignal: AbortSignal | null | undefined;
    mockHungFetch((url, signal) => {
      if (url.includes("/v1/config/")) configSignal = signal;
    });

    const client = new TrafficalClient({
      orgId: "org_1",
      projectId: "proj_1",
      env: "test",
      apiKey: "pk",
      trackDecisions: false,
      refreshIntervalMs: -1,
      disableCloudEvents: true,
      // Canonical tiny timeout must win over the huge legacy value; otherwise
      // initialize() would hang ~100s and this test would time out.
      configTimeoutMs: 20,
      requestTimeoutMs: 100000,
    });

    await client.initialize();
    expect(warnings.some((w) => w.includes("Failed to fetch config"))).toBe(true);
    expect(configSignal?.aborted).toBe(true);
    await client.close();
  });
});

describe("eventsTimeoutMs alias", () => {
  test("canonical eventsTimeoutMs aborts a hung events POST (canonical wins over legacy)", async () => {
    console.warn = () => {};
    let eventsSignal: AbortSignal | null | undefined;
    mockHungFetch((url, signal) => {
      if (url.includes("/v1/events/batch")) eventsSignal = signal;
    });

    const client = new TrafficalClient({
      ...baseOpts(),
      batchSize: 1, // flush after one event
      eventsTimeoutMs: 20, // canonical tiny value...
      requestTimeoutMs: 100000, // ...must win over the huge legacy fallback
    });
    // localConfig is preloaded, so no config fetch is needed before tracking.
    client.track("purchase", { orderId: "o1" }, { unitKey: "user-1" });

    await new Promise((r) => setTimeout(r, 80));
    expect(eventsSignal).toBeDefined();
    expect(eventsSignal?.aborted).toBe(true);
    // destroySync() avoids awaiting a final flush against the still-hung fetch.
    client.destroySync();
  });
});
