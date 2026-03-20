/**
 * Warehouse-native assignment logger factory.
 *
 * Convenience helper that returns an AssignmentLogger function for common
 * destinations (Segment, Rudderstack, or a custom handler). Pass the returned
 * function as the `assignmentLogger` option to the TrafficalClient constructor.
 */

import type { AssignmentLogEntry, AssignmentLogger } from "@traffical/core";

export interface WarehouseNativeLoggerOptions {
  /** Where to send assignment log entries */
  destination:
    | { type: "segment"; analytics: { track: (event: string, props: Record<string, unknown>) => void } }
    | { type: "rudderstack"; analytics: { track: (event: string, props: Record<string, unknown>) => void } }
    | { type: "custom"; handler: AssignmentLogger };
  /** Event name used for Segment/Rudderstack track calls (default: "Experiment Assignment") */
  eventName?: string;
}

/**
 * Creates an AssignmentLogger that routes structured assignment entries
 * to Segment, Rudderstack, or a custom handler.
 *
 * @example
 * ```ts
 * import { createWarehouseNativeLoggerPlugin } from "@traffical/js-client";
 *
 * const client = new TrafficalClient({
 *   // ...
 *   assignmentLogger: createWarehouseNativeLoggerPlugin({
 *     destination: { type: "segment", analytics },
 *   }),
 * });
 * ```
 */
export function createWarehouseNativeLoggerPlugin(
  options: WarehouseNativeLoggerOptions,
): AssignmentLogger {
  if (options.destination.type === "custom") {
    return options.destination.handler;
  }

  const eventName = options.eventName ?? "Experiment Assignment";
  const analytics = options.destination.analytics;

  return (entry: AssignmentLogEntry) => {
    analytics.track(eventName, {
      unit_key: entry.unitKey,
      policy_id: entry.policyId,
      allocation_name: entry.allocationName,
      timestamp: entry.timestamp,
      layer_id: entry.layerId,
      allocation_id: entry.allocationId,
      org_id: entry.orgId,
      project_id: entry.projectId,
      env: entry.env,
      ...entry.properties,
    });
  };
}
