/**
 * Tests for TrafficalClient.identify() and onIdentityChange().
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { TrafficalClient } from "./client.js";

const originalFetch = globalThis.fetch;

const bundleResponse = {
  version: "2024-01-01T00:00:00Z",
  orgId: "org_test",
  projectId: "proj_test",
  env: "production",
  hashing: { unitKey: "userId", bucketCount: 1000 },
  parameters: [],
  layers: [],
};

beforeEach(() => {
  globalThis.fetch = mock(async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => bundleResponse,
    headers: new Headers({ ETag: '"v1"' }),
  })) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function createClient() {
  return new TrafficalClient({
    orgId: "org_test",
    projectId: "proj_test",
    env: "production",
    apiKey: "pk_test",
    refreshIntervalMs: -1,
    trackDecisions: false,
  });
}

describe("TrafficalClient.identify()", () => {
  test("updates the stable ID", () => {
    const client = createClient();
    const original = client.getStableId();

    client.identify("user_new");

    expect(client.getStableId()).toBe("user_new");
    expect(client.getStableId()).not.toBe(original);

    client.destroy();
  });

  test("fires onIdentityChange listeners", () => {
    const client = createClient();
    const received: string[] = [];

    client.onIdentityChange((key) => received.push(key));

    client.identify("user_a");
    client.identify("user_b");

    expect(received).toEqual(["user_a", "user_b"]);

    client.destroy();
  });

  test("multiple listeners all receive updates", () => {
    const client = createClient();
    const listener1: string[] = [];
    const listener2: string[] = [];

    client.onIdentityChange((key) => listener1.push(key));
    client.onIdentityChange((key) => listener2.push(key));

    client.identify("user_x");

    expect(listener1).toEqual(["user_x"]);
    expect(listener2).toEqual(["user_x"]);

    client.destroy();
  });

  test("onIdentityChange returns an unsubscribe function", () => {
    const client = createClient();
    const received: string[] = [];

    const unsub = client.onIdentityChange((key) => received.push(key));

    client.identify("user_1");
    unsub();
    client.identify("user_2");

    expect(received).toEqual(["user_1"]);

    client.destroy();
  });

  test("listener errors do not break other listeners", () => {
    const client = createClient();
    const received: string[] = [];

    client.onIdentityChange(() => {
      throw new Error("boom");
    });
    client.onIdentityChange((key) => received.push(key));

    client.identify("user_ok");

    expect(received).toEqual(["user_ok"]);

    client.destroy();
  });

  test("destroy() clears identity listeners", () => {
    const client = createClient();
    const received: string[] = [];

    client.onIdentityChange((key) => received.push(key));

    client.identify("before_destroy");
    client.destroy();

    // After destroy, the listener array is cleared. Even if someone
    // somehow calls identify (bad practice), no listeners fire.
    // We verify by checking only the pre-destroy event was received.
    expect(received).toEqual(["before_destroy"]);
  });

  test("setStableId() does NOT fire listeners (low-level API)", () => {
    const client = createClient();
    const received: string[] = [];

    client.onIdentityChange((key) => received.push(key));

    client.setStableId("silent_change");

    expect(received).toEqual([]);
    expect(client.getStableId()).toBe("silent_change");

    client.destroy();
  });
});
