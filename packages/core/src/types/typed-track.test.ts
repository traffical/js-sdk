/**
 * Type-level tests for TypedTrackFn.
 *
 * These tests use @ts-expect-error to verify compile-time constraints.
 * They don't test runtime behavior — only that the type system correctly
 * rejects invalid usage and accepts valid usage.
 */

import { describe, test, expect } from "bun:test";
import type { TypedTrackFn, TrackEventMap } from "./index.js";

// ============================================================================
// Test event map (simulates codegen output)
// ============================================================================

interface TestEvents {
  checkout_completed: {
    order_id: string;
    total: number;
    currency?: string;
  };
  page_viewed: {
    url: string;
    referrer?: string;
  };
  button_clicked: {
    button_id: string;
  };
}

describe("TypedTrackFn", () => {
  test("accepts valid event name and properties", () => {
    const track: TypedTrackFn<TestEvents> = (() => {}) as any;

    track("checkout_completed", { order_id: "ORD-1", total: 99.99 });
    track("page_viewed", { url: "/home" });
    track("button_clicked", { button_id: "cta" });

    expect(true).toBe(true);
  });

  test("accepts optional properties", () => {
    const track: TypedTrackFn<TestEvents> = (() => {}) as any;

    track("checkout_completed", {
      order_id: "ORD-1",
      total: 99.99,
      currency: "USD",
    });
    track("page_viewed", { url: "/home", referrer: "https://google.com" });

    expect(true).toBe(true);
  });

  test("accepts call with options parameter", () => {
    const track: TypedTrackFn<TestEvents> = (() => {}) as any;

    track("checkout_completed", { order_id: "ORD-1", total: 99.99 }, {
      decisionId: "dec_123",
      unitKey: "user_456",
    });

    expect(true).toBe(true);
  });

  test("rejects unknown event names", () => {
    const track: TypedTrackFn<TestEvents> = (() => {}) as any;

    // @ts-expect-error - 'unknown_event' is not in TestEvents
    track("unknown_event", {});

    expect(true).toBe(true);
  });

  test("rejects wrong property types", () => {
    const track: TypedTrackFn<TestEvents> = (() => {}) as any;

    // @ts-expect-error - total should be number, not string
    track("checkout_completed", { order_id: "ORD-1", total: "99.99" });

    expect(true).toBe(true);
  });

  test("default TrackEventMap accepts any string and properties", () => {
    const track: TypedTrackFn = (() => {}) as any;

    track("anything", { any: "properties" });
    track("whatever", { foo: 123, bar: true });

    expect(true).toBe(true);
  });

  test("default TrackEventMap is backward compatible", () => {
    const track: TypedTrackFn<TrackEventMap> = (() => {}) as any;

    track("any_event_name", { key: "value" });
    track("another_event", {});

    expect(true).toBe(true);
  });
});
