import { describe, test, expect, mock } from "bun:test";
import {
  createWarehouseNativeLoggerPlugin,
  createWarehouseNativeLogger,
} from "./warehouse-native-logger.ts";
import type {
  AssignmentLogEntry,
  ExposureEvent,
  TrackEvent,
} from "@traffical/core";

function sampleEntry(overrides: Partial<AssignmentLogEntry> = {}): AssignmentLogEntry {
  return {
    unitKey: "u1",
    policyId: "pol_1",
    allocationName: "treatment",
    timestamp: "2025-01-01T00:00:00.000Z",
    layerId: "layer_1",
    allocationId: "alloc_1",
    orgId: "org_1",
    projectId: "proj_1",
    env: "production",
    type: "decision",
    ...overrides,
  };
}

describe("createWarehouseNativeLoggerPlugin", () => {
  test('Segment destination: calls analytics.track() with "Experiment Assignment" and correct props', () => {
    const track = mock(() => {});
    const entry = sampleEntry();
    const logger = createWarehouseNativeLoggerPlugin({
      destination: { type: "segment", analytics: { track } },
    });
    logger(entry);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track.mock.calls[0]).toEqual([
      "Experiment Assignment",
      {
        unit_key: "u1",
        policy_id: "pol_1",
        allocation_name: "treatment",
        timestamp: "2025-01-01T00:00:00.000Z",
        layer_id: "layer_1",
        allocation_id: "alloc_1",
        org_id: "org_1",
        project_id: "proj_1",
        env: "production",
        type: "decision",
        decision_id: undefined,
        anonymous_id: undefined,
        assignment_id: undefined,
      },
    ]);
  });

  test("Rudderstack destination: same behavior as Segment", () => {
    const track = mock(() => {});
    const entry = sampleEntry();
    const logger = createWarehouseNativeLoggerPlugin({
      destination: { type: "rudderstack", analytics: { track } },
    });
    logger(entry);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track.mock.calls[0]?.[0]).toBe("Experiment Assignment");
    expect(track.mock.calls[0]?.[1]).toEqual({
      unit_key: "u1",
      policy_id: "pol_1",
      allocation_name: "treatment",
      timestamp: "2025-01-01T00:00:00.000Z",
      layer_id: "layer_1",
      allocation_id: "alloc_1",
      org_id: "org_1",
      project_id: "proj_1",
      env: "production",
      type: "decision",
      decision_id: undefined,
      anonymous_id: undefined,
      assignment_id: undefined,
    });
  });

  test("Custom handler: delegates to handler function", () => {
    const handler = mock((_entry: AssignmentLogEntry) => {});
    const entry = sampleEntry();
    const logger = createWarehouseNativeLoggerPlugin({
      destination: { type: "custom", handler },
    });
    logger(entry);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toBe(entry);
  });

  test("Custom event name respected", () => {
    const track = mock(() => {});
    const logger = createWarehouseNativeLoggerPlugin({
      destination: { type: "segment", analytics: { track } },
      eventName: "My Assignment Event",
    });
    logger(sampleEntry());
    expect(track.mock.calls[0]?.[0]).toBe("My Assignment Event");
  });

  test("All AssignmentLogEntry fields mapped correctly", () => {
    const track = mock(() => {});
    const entry = sampleEntry({
      unitKey: "user-99",
      policyId: "exp_checkout",
      allocationName: "control",
      timestamp: "2025-06-15T12:30:00.000Z",
      layerId: "layer_checkout",
      allocationId: "alloc_ctrl",
      orgId: "org_acme",
      projectId: "proj_web",
      env: "staging",
      type: "exposure",
      decisionId: "dec_abc",
      anonymousId: "anon_xyz",
      id: "asn_123",
    });
    createWarehouseNativeLoggerPlugin({
      destination: { type: "segment", analytics: { track } },
    })(entry);
    expect(track.mock.calls[0]?.[1]).toEqual({
      unit_key: "user-99",
      policy_id: "exp_checkout",
      allocation_name: "control",
      timestamp: "2025-06-15T12:30:00.000Z",
      layer_id: "layer_checkout",
      allocation_id: "alloc_ctrl",
      org_id: "org_acme",
      project_id: "proj_web",
      env: "staging",
      type: "exposure",
      decision_id: "dec_abc",
      anonymous_id: "anon_xyz",
      assignment_id: "asn_123",
    });
  });

  test("Entry properties spread into track properties", () => {
    const track = mock(() => {});
    const entry = sampleEntry({
      properties: { cohort: "vip", score: 0.9 },
    });
    createWarehouseNativeLoggerPlugin({
      destination: { type: "rudderstack", analytics: { track } },
    })(entry);
    expect(track.mock.calls[0]?.[1]).toEqual({
      unit_key: "u1",
      policy_id: "pol_1",
      allocation_name: "treatment",
      timestamp: "2025-01-01T00:00:00.000Z",
      layer_id: "layer_1",
      allocation_id: "alloc_1",
      org_id: "org_1",
      project_id: "proj_1",
      env: "production",
      type: "decision",
      decision_id: undefined,
      anonymous_id: undefined,
      assignment_id: undefined,
      cohort: "vip",
      score: 0.9,
    });
  });
});

function sampleExposure(overrides: Partial<ExposureEvent> = {}): ExposureEvent {
  return {
    type: "exposure",
    id: "exp_1",
    decisionId: "dec_1",
    orgId: "org_1",
    projectId: "proj_1",
    env: "production",
    unitKey: "u1",
    timestamp: "2025-01-01T00:00:00.000Z",
    assignments: { "ui.color": "#F00" },
    layers: [],
    ...overrides,
  };
}

function sampleTrack(overrides: Partial<TrackEvent> = {}): TrackEvent {
  return {
    type: "track",
    id: "trk_1",
    orgId: "org_1",
    projectId: "proj_1",
    env: "production",
    unitKey: "u1",
    timestamp: "2025-01-01T00:00:00.000Z",
    event: "add_to_cart",
    value: 9.99,
    properties: { sku: "abc" },
    ...overrides,
  };
}

describe("createWarehouseNativeLogger", () => {
  test("returns both assignmentLogger and eventLogger", () => {
    const track = mock(() => {});
    const { assignmentLogger, eventLogger } = createWarehouseNativeLogger({
      destination: { type: "segment", analytics: { track } },
    });
    expect(typeof assignmentLogger).toBe("function");
    expect(typeof eventLogger).toBe("function");
  });

  test("Segment eventLogger: exposure -> 'Experiment Exposure'", () => {
    const track = mock(() => {});
    const { eventLogger } = createWarehouseNativeLogger({
      destination: { type: "segment", analytics: { track } },
    });
    eventLogger(sampleExposure());
    expect(track.mock.calls[0]?.[0]).toBe("Experiment Exposure");
    expect(track.mock.calls[0]?.[1]).toMatchObject({
      unit_key: "u1",
      type: "exposure",
      decision_id: "dec_1",
      event_id: "exp_1",
    });
  });

  test("Segment eventLogger: track keeps its own event name and props", () => {
    const track = mock(() => {});
    const { eventLogger } = createWarehouseNativeLogger({
      destination: { type: "segment", analytics: { track } },
    });
    eventLogger(sampleTrack());
    expect(track.mock.calls[0]?.[0]).toBe("add_to_cart");
    expect(track.mock.calls[0]?.[1]).toMatchObject({
      unit_key: "u1",
      type: "track",
      value: 9.99,
      sku: "abc",
    });
  });

  test("custom destination routes assignment and event handlers separately", () => {
    const assignmentHandler = mock((_e: AssignmentLogEntry) => {});
    const eventHandler = mock(() => {});
    const { assignmentLogger, eventLogger } = createWarehouseNativeLogger({
      destination: { type: "custom", assignmentHandler, eventHandler },
    });
    assignmentLogger(sampleEntry());
    eventLogger(sampleTrack());
    expect(assignmentHandler).toHaveBeenCalledTimes(1);
    expect(eventHandler).toHaveBeenCalledTimes(1);
  });

  test("jitsu destination POSTs Segment envelopes via fetch", () => {
    const fetchImpl = mock(async () => ({ ok: true, status: 200 }) as unknown as Response);
    const { assignmentLogger, eventLogger } = createWarehouseNativeLogger({
      destination: {
        type: "jitsu",
        host: "/api/jitsu",
        mode: "s2s",
        endpoint: (type) => `/api/jitsu/${type}`,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    });

    eventLogger(sampleTrack());
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/jitsu/track");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      type: "track",
      event: "add_to_cart",
      userId: "u1",
      messageId: "trk_1",
    });
    expect(body.properties).toMatchObject({ value: 9.99, sku: "abc" });

    assignmentLogger(sampleEntry());
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const assignmentBody = JSON.parse(
      (fetchImpl.mock.calls[1] as [string, RequestInit])[1].body as string,
    );
    expect(assignmentBody).toMatchObject({
      type: "track",
      event: "Experiment Assignment",
      userId: "u1",
    });
  });
});
