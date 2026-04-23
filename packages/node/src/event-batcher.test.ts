/**
 * Tests for EventBatcher schema warning callback.
 *
 * Validates:
 * - onSchemaWarnings callback is invoked when edge returns warnings
 * - Callback is NOT invoked when there are no warnings
 * - Response body is NOT parsed when onSchemaWarnings is not set
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { EventBatcher } from "./event-batcher.js";
import type { EventSchemaWarning, TrackEvent } from "@traffical/core";

function createTrackEvent(overrides: Partial<TrackEvent> = {}): TrackEvent {
  return {
    type: "track",
    id: "evt_test",
    orgId: "org_1",
    projectId: "proj_1",
    env: "test",
    unitKey: "user_1",
    timestamp: new Date().toISOString(),
    event: "test_event",
    ...overrides,
  };
}

const mockWarnings: EventSchemaWarning[] = [
  {
    index: 0,
    event: "checkout_completed",
    violations: [
      { path: "/properties/total", message: "must be number", rule: "type" },
    ],
  },
];

describe("EventBatcher schema warnings", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("invokes onSchemaWarnings when edge returns warnings", async () => {
    const receivedWarnings: EventSchemaWarning[][] = [];

    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            accepted: 1,
            schemaWarnings: mockWarnings,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    ) as any;

    const batcher = new EventBatcher({
      endpoint: "https://test.example.com/v1/events/batch",
      apiKey: "pk_test",
      batchSize: 100,
      flushIntervalMs: 999999,
      onSchemaWarnings: (warnings) => {
        receivedWarnings.push(warnings);
      },
    });

    batcher.log(createTrackEvent());
    await batcher.flush();

    expect(receivedWarnings).toHaveLength(1);
    expect(receivedWarnings[0]).toEqual(mockWarnings);

    await batcher.destroy();
  });

  test("does NOT invoke callback when no warnings in response", async () => {
    const receivedWarnings: EventSchemaWarning[][] = [];

    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ accepted: 1 }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    ) as any;

    const batcher = new EventBatcher({
      endpoint: "https://test.example.com/v1/events/batch",
      apiKey: "pk_test",
      batchSize: 100,
      flushIntervalMs: 999999,
      onSchemaWarnings: (warnings) => {
        receivedWarnings.push(warnings);
      },
    });

    batcher.log(createTrackEvent());
    await batcher.flush();

    expect(receivedWarnings).toHaveLength(0);

    await batcher.destroy();
  });

  test("does NOT parse response body when onSchemaWarnings is not set", async () => {
    let jsonCalled = false;

    globalThis.fetch = mock(() => {
      const resp = new Response(
        JSON.stringify({ accepted: 1, schemaWarnings: mockWarnings }),
        { status: 200 }
      );
      const originalJson = resp.json.bind(resp);
      Object.defineProperty(resp, "json", {
        value: () => {
          jsonCalled = true;
          return originalJson();
        },
        writable: true,
      });
      return Promise.resolve(resp);
    }) as any;

    const batcher = new EventBatcher({
      endpoint: "https://test.example.com/v1/events/batch",
      apiKey: "pk_test",
      batchSize: 100,
      flushIntervalMs: 999999,
    });

    batcher.log(createTrackEvent());
    await batcher.flush();

    expect(jsonCalled).toBe(false);

    await batcher.destroy();
  });

  test("handles response parse errors gracefully", async () => {
    const receivedWarnings: EventSchemaWarning[][] = [];

    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response("not json", { status: 200 })
      )
    ) as any;

    const batcher = new EventBatcher({
      endpoint: "https://test.example.com/v1/events/batch",
      apiKey: "pk_test",
      batchSize: 100,
      flushIntervalMs: 999999,
      onSchemaWarnings: (warnings) => {
        receivedWarnings.push(warnings);
      },
    });

    batcher.log(createTrackEvent());
    await batcher.flush();

    expect(receivedWarnings).toHaveLength(0);

    await batcher.destroy();
  });
});
