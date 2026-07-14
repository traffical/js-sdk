/**
 * Spec 0.7.0 contract behaviors for the browser SDK: S4 single-event exposure
 * shape (filtered + deduped), the close()/waitForReady() lifecycle verbs,
 * positional decide/getParams, the track() options bag, and the EventLogger
 * bounded queue / 401 kill-switch.
 */
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { TrafficalClient } from "./client.js";
import { EventLogger } from "./event-logger.js";
import { MemoryStorageProvider } from "./storage.js";
import type { ConfigBundle, ExposureEvent, TrackEvent, TrackableEvent } from "@traffical/core";

/** A bundle with a requested-param layer + a second layer that stays attributionOnly. */
const localConfig = {
  version: "2024-06-01T00:00:00.000Z",
  orgId: "org_1",
  projectId: "proj_1",
  env: "test",
  hashing: { unitKey: "userId", bucketCount: 1000 },
  parameters: [
    { key: "ui.color", type: "string", default: "#000", layerId: "layer_ui", namespace: "ui" },
    { key: "promo.on", type: "boolean", default: false, layerId: "layer_promo", namespace: "promo" },
  ],
  layers: [
    {
      id: "layer_ui",
      policies: [
        {
          id: "pol_ui",
          state: "running",
          kind: "static",
          allocations: [
            { name: "control", bucketRange: [0, 499], overrides: { "ui.color": "#111" } },
            { name: "treatment", bucketRange: [500, 999], overrides: { "ui.color": "#F00" } },
          ],
          conditions: [],
        },
      ],
    },
    {
      id: "layer_promo",
      policies: [
        {
          id: "pol_promo",
          state: "running",
          kind: "static",
          allocations: [
            { name: "off", bucketRange: [0, 499], overrides: { "promo.on": false } },
            { name: "on", bucketRange: [500, 999], overrides: { "promo.on": true } },
          ],
          conditions: [],
        },
      ],
    },
  ],
} as unknown as ConfigBundle;

function makeClient(capture: TrackableEvent[]) {
  return new TrafficalClient({
    orgId: "org_1",
    projectId: "proj_1",
    env: "test",
    apiKey: "pk",
    localConfig,
    disableCloudEvents: true,
    trackDecisions: false,
    storage: new MemoryStorageProvider(),
    eventLogger: (e) => capture.push(e),
  });
}

describe("js-client S4 exposure shape", () => {
  test("emits ONE event with only the newly-exposed non-attributionOnly layer", () => {
    const captured: TrackableEvent[] = [];
    const client = makeClient(captured);
    // Request only ui.color -> layer_promo is resolved for attribution only.
    const decision = client.decide({ userId: "user-1" }, { "ui.color": "#000" });
    client.trackExposure(decision);

    const exposures = captured.filter((e): e is ExposureEvent => e.type === "exposure");
    expect(exposures).toHaveLength(1);
    expect(exposures[0].layers).toHaveLength(1);
    expect(exposures[0].layers[0].layerId).toBe("layer_ui");
    // attributionOnly layer excluded.
    expect(exposures[0].layers.some((l) => l.layerId === "layer_promo")).toBe(false);
  });

  test("dedups within the session: a second trackExposure emits nothing", () => {
    const captured: TrackableEvent[] = [];
    const client = makeClient(captured);
    const decision = client.decide({ userId: "user-1" }, { "ui.color": "#000" });
    client.trackExposure(decision);
    client.trackExposure(decision);

    const exposures = captured.filter((e) => e.type === "exposure");
    expect(exposures).toHaveLength(1);
  });
});

describe("js-client lifecycle + eval API", () => {
  test("waitForReady() resolves after initialize()", async () => {
    const client = makeClient([]);
    await client.initialize();
    await client.waitForReady();
    expect(client.isInitialized).toBe(true);
  });

  test("positional decide(context, defaults) matches the object bag", () => {
    const client = makeClient([]);
    const positional = client.decide({ userId: "user-1" }, { "ui.color": "#000" });
    const bag = client.decide({ context: { userId: "user-1" }, defaults: { "ui.color": "#000" } });
    expect(positional.assignments).toEqual(bag.assignments);
  });

  test("track() options bag carries value/values/eventTimestamp", () => {
    const captured: TrackableEvent[] = [];
    const client = makeClient(captured);
    const ts = "2024-06-01T00:00:00.000Z";
    client.track("purchase", { orderId: "o1" }, {
      unitKey: "user-1",
      value: 25,
      values: { revenue: 25, items: 3 },
      eventTimestamp: ts,
    });
    const track = captured.find((e): e is TrackEvent => e.type === "track");
    expect(track!.value).toBe(25);
    expect(track!.values).toEqual({ revenue: 25, items: 3 });
    expect(track!.eventTimestamp).toBe(ts);
  });

  test("close() awaits the final flush (delivers buffered events)", async () => {
    const posted: TrackableEvent[][] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      posted.push(body.events);
      return new Response(JSON.stringify({ accepted: body.events.length }), { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const client = new TrafficalClient({
        orgId: "org_1",
        projectId: "proj_1",
        env: "test",
        apiKey: "pk",
        localConfig,
        trackDecisions: false,
        storage: new MemoryStorageProvider(),
        eventFlushIntervalMs: 999999, // never auto-flush on a timer
      });
      client.track("purchase", { orderId: "o1" }, { unitKey: "user-1", value: 5 });
      await client.close();
      // The final flush shipped the buffered track event before close resolved.
      const all = posted.flat();
      expect(all.some((e) => e.type === "track")).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("js-client EventLogger hardening (S8)", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function trackEvent(id: string): TrackEvent {
    return {
      type: "track",
      id,
      orgId: "o",
      projectId: "p",
      env: "test",
      unitKey: "u",
      timestamp: new Date().toISOString(),
      event: "e",
    };
  }

  test("bounded queue drops oldest and counts drops", () => {
    const logger = new EventLogger({
      endpoint: "https://x/v1/events/batch",
      apiKey: "pk",
      storage: new MemoryStorageProvider(),
      batchSize: 1000,
      flushIntervalMs: 999999,
      maxQueueSize: 2,
    });
    logger.log(trackEvent("a"));
    logger.log(trackEvent("b"));
    logger.log(trackEvent("c"));
    expect(logger.queueSize).toBe(2);
    expect(logger.droppedCount).toBe(1);
    logger.destroy();
  });

  test("HTTP 401 permanently disables delivery and clears persisted events", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("no", { status: 401 }))
    ) as unknown as typeof fetch;

    const storage = new MemoryStorageProvider();
    const logger = new EventLogger({
      endpoint: "https://x/v1/events/batch",
      apiKey: "pk",
      storage,
      batchSize: 1000,
      flushIntervalMs: 999999,
    });
    logger.log(trackEvent("a"));
    await logger.flush();

    expect(logger.isDisabled).toBe(true);
    expect(logger.queueSize).toBe(0);
    expect(storage.get("failed_events")).toBeNull();

    logger.log(trackEvent("b"));
    expect(logger.queueSize).toBe(0); // no buffering after kill-switch
    logger.destroy();
  });
});
