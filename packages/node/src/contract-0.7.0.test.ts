/**
 * Spec 0.7.0 contract behaviors for the Node SDK: bounded event queue with
 * drop-oldest, exponential-backoff retry + re-queue, HTTP 401 kill-switch,
 * trackReward value/decisionId forwarding, positional decide/getParams, and
 * the close()/waitForReady() lifecycle verbs.
 */
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { EventBatcher } from "./event-batcher.js";
import { TrafficalClient } from "./client.js";
import type { TrackableEvent, TrackEvent } from "@traffical/core";

function trackEvent(id = "evt"): TrackEvent {
  return {
    type: "track",
    id,
    orgId: "org_1",
    projectId: "proj_1",
    env: "test",
    unitKey: "u1",
    timestamp: new Date().toISOString(),
    event: "e",
  };
}

describe("EventBatcher bounded queue (S8)", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("drops the oldest event when the queue is full and counts drops", () => {
    // Never auto-flush (huge batchSize + interval), tiny queue cap.
    const batcher = new EventBatcher({
      endpoint: "https://x/v1/events/batch",
      apiKey: "pk",
      batchSize: 1000,
      flushIntervalMs: 999999,
      maxQueueSize: 2,
    });
    batcher.log(trackEvent("a"));
    batcher.log(trackEvent("b"));
    batcher.log(trackEvent("c")); // evicts "a"
    expect(batcher.queueSize).toBe(2);
    expect(batcher.droppedCount).toBe(1);
    batcher.destroySync();
  });

  test("HTTP 401 permanently disables delivery and clears the queue", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("no", { status: 401 }))
    ) as unknown as typeof fetch;

    const batcher = new EventBatcher({
      endpoint: "https://x/v1/events/batch",
      apiKey: "pk",
      batchSize: 1000,
      flushIntervalMs: 999999,
    });
    batcher.log(trackEvent("a"));
    await batcher.flush();

    expect(batcher.isDisabled).toBe(true);
    expect(batcher.queueSize).toBe(0);

    // Subsequent logs are dropped (no buffering after kill-switch).
    batcher.log(trackEvent("b"));
    expect(batcher.queueSize).toBe(0);
    batcher.destroySync();
  });

  test("retries a 5xx with backoff, then re-queues the batch", async () => {
    const fetchMock = mock(() =>
      Promise.resolve(new Response("err", { status: 503 }))
    ) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    const errors: Error[] = [];
    const batcher = new EventBatcher({
      endpoint: "https://x/v1/events/batch",
      apiKey: "pk",
      batchSize: 1000,
      flushIntervalMs: 999999,
      maxRetries: 2,
      retryBackoffMs: 1,
      onError: (e) => errors.push(e),
    });
    batcher.log(trackEvent("a"));
    await batcher.flush();

    // 1 initial + 2 retries = 3 attempts, then re-queued for a later flush.
    expect((fetchMock as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(3);
    expect(batcher.queueSize).toBe(1);
    expect(errors).toHaveLength(1);
    expect(batcher.isDisabled).toBe(false);
    batcher.destroySync();
  });
});

describe("Node client contract (S8 + A1)", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    // Config fetch 404 => fail-open; client stays usable with caller defaults.
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("not found", { status: 404 }))
    ) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("waitForReady() resolves even when the bundle 404s (fail-open)", async () => {
    const client = new TrafficalClient({
      orgId: "o",
      projectId: "p",
      env: "test",
      apiKey: "pk",
      disableCloudEvents: true,
    });
    await client.initialize();
    await client.waitForReady(); // must not hang
    expect(true).toBe(true);
    await client.close();
  });

  test("positional decide(context, defaults) matches the legacy object bag", async () => {
    const client = new TrafficalClient({
      orgId: "o",
      projectId: "p",
      env: "test",
      apiKey: "pk",
      disableCloudEvents: true,
      trackDecisions: false,
    });
    await client.initialize();

    const positional = client.decide({ userId: "u1" }, { "ui.color": "#000" });
    const bag = client.decide({ context: { userId: "u1" }, defaults: { "ui.color": "#000" } });
    expect(positional.assignments).toEqual(bag.assignments);
    expect(positional.metadata.unitKeyValue).toBe(bag.metadata.unitKeyValue);
    await client.close();
  });

  test("trackReward forwards value and decisionId (previously dropped)", async () => {
    const captured: TrackableEvent[] = [];
    const client = new TrafficalClient({
      orgId: "o",
      projectId: "p",
      env: "test",
      apiKey: "pk",
      disableCloudEvents: true,
      trackDecisions: false,
      eventLogger: (e) => captured.push(e),
    });
    await client.initialize();

    const decision = client.decide({ userId: "u1" }, { "ui.color": "#000" });
    client.trackReward({ event: "purchase", value: 42, decisionId: decision.decisionId });

    const track = captured.find((e) => e.type === "track") as TrackEvent | undefined;
    expect(track).toBeDefined();
    expect(track!.value).toBe(42);
    expect(track!.decisionId).toBe(decision.decisionId);
    await client.close();
  });

  test("track() options bag carries value/values/eventTimestamp", async () => {
    const captured: TrackableEvent[] = [];
    const client = new TrafficalClient({
      orgId: "o",
      projectId: "p",
      env: "test",
      apiKey: "pk",
      disableCloudEvents: true,
      trackDecisions: false,
      eventLogger: (e) => captured.push(e),
    });
    await client.initialize();

    const ts = "2024-06-01T00:00:00.000Z";
    client.track("purchase", { orderId: "o1" }, {
      unitKey: "u1",
      value: 10,
      values: { revenue: 10, items: 2 },
      eventTimestamp: ts,
    });
    const track = captured.find((e) => e.type === "track") as TrackEvent | undefined;
    expect(track!.value).toBe(10);
    expect(track!.values).toEqual({ revenue: 10, items: 2 });
    expect(track!.eventTimestamp).toBe(ts);
    await client.close();
  });
});
