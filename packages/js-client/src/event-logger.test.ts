/**
 * Tests for EventLogger schema warning callback.
 *
 * Validates:
 * - onSchemaWarnings callback is invoked when edge returns warnings
 * - Callback is NOT invoked when there are no warnings
 * - Response body is NOT parsed when onSchemaWarnings is not set
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { EventLogger } from "./event-logger.js";
import type { StorageProvider } from "./storage.js";
import type { EventSchemaWarning, TrackEvent } from "@traffical/core";

function createMockStorage(): StorageProvider {
  const store = new Map<string, unknown>();
  return {
    get: <T>(key: string) => (store.get(key) as T) ?? null,
    set: <T>(key: string, value: T) => { store.set(key, value); },
    remove: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
  };
}

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

describe("EventLogger schema warnings", () => {
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

    const logger = new EventLogger({
      endpoint: "https://test.example.com/v1/events/batch",
      apiKey: "pk_test",
      storage: createMockStorage(),
      batchSize: 1,
      flushIntervalMs: 999999,
      onSchemaWarnings: (warnings) => {
        receivedWarnings.push(warnings);
      },
    });

    logger.log(createTrackEvent());

    // Wait for flush to complete
    await new Promise((r) => setTimeout(r, 100));

    expect(receivedWarnings).toHaveLength(1);
    expect(receivedWarnings[0]).toEqual(mockWarnings);

    logger.destroy();
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

    const logger = new EventLogger({
      endpoint: "https://test.example.com/v1/events/batch",
      apiKey: "pk_test",
      storage: createMockStorage(),
      batchSize: 1,
      flushIntervalMs: 999999,
      onSchemaWarnings: (warnings) => {
        receivedWarnings.push(warnings);
      },
    });

    logger.log(createTrackEvent());

    await new Promise((r) => setTimeout(r, 100));

    expect(receivedWarnings).toHaveLength(0);

    logger.destroy();
  });

  test("does NOT parse response body when onSchemaWarnings is not set", async () => {
    let jsonCalled = false;

    const mockResponse = new Response(
      JSON.stringify({ accepted: 1, schemaWarnings: mockWarnings }),
      { status: 200 }
    );

    const originalJson = mockResponse.json.bind(mockResponse);
    mockResponse.json = () => {
      jsonCalled = true;
      return originalJson();
    };

    globalThis.fetch = mock(() => Promise.resolve(mockResponse)) as any;

    const logger = new EventLogger({
      endpoint: "https://test.example.com/v1/events/batch",
      apiKey: "pk_test",
      storage: createMockStorage(),
      batchSize: 1,
      flushIntervalMs: 999999,
    });

    logger.log(createTrackEvent());

    await new Promise((r) => setTimeout(r, 100));

    expect(jsonCalled).toBe(false);

    logger.destroy();
  });

  test("handles response parse errors gracefully", async () => {
    const receivedWarnings: EventSchemaWarning[][] = [];

    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response("not json", { status: 200 })
      )
    ) as any;

    const logger = new EventLogger({
      endpoint: "https://test.example.com/v1/events/batch",
      apiKey: "pk_test",
      storage: createMockStorage(),
      batchSize: 1,
      flushIntervalMs: 999999,
      onSchemaWarnings: (warnings) => {
        receivedWarnings.push(warnings);
      },
    });

    logger.log(createTrackEvent());

    await new Promise((r) => setTimeout(r, 100));

    expect(receivedWarnings).toHaveLength(0);

    logger.destroy();
  });
});
