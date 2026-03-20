import { describe, test, expect, mock } from "bun:test";
import { createWarehouseNativeLoggerPlugin } from "./warehouse-native-logger.ts";
import type { AssignmentLogEntry } from "@traffical/core";

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
      cohort: "vip",
      score: 0.9,
    });
  });
});
