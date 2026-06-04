/**
 * Warehouse-native logger factory.
 *
 * Convenience helpers that route Traffical data to a customer-managed
 * pipeline. Two flavours:
 *
 * - `assignmentLogger`: structured AssignmentLogEntry rows (decide/expose).
 * - `eventLogger`: full SDK events (exposure / track / decision).
 *
 * Supported destinations: Segment, Rudderstack, Jitsu (HTTP), or a custom
 * handler. Use `createWarehouseNativeLogger(...)` to get both loggers, or the
 * back-compat `createWarehouseNativeLoggerPlugin(...)` for just the
 * assignment logger.
 */

import type {
  AssignmentLogEntry,
  AssignmentLogger,
  TrackableEvent,
  TrackableEventLogger,
} from "@traffical/core";

/** Minimal Segment/Rudderstack analytics surface used by this factory. */
export interface AnalyticsLike {
  track: (event: string, props: Record<string, unknown>) => void;
}

/**
 * Jitsu HTTP destination.
 *
 * Builds Segment-compatible payloads and POSTs them to a Jitsu ingest
 * endpoint. By default the URL is `${host}/api/s/{type}` (client mode) or
 * `${host}/api/s/s2s/{type}` (server-to-server mode). Provide `endpoint` to
 * fully control the URL (e.g. when posting through your own proxy route).
 */
export interface JitsuDestination {
  type: "jitsu";
  /** Ingest host, e.g. "https://xxxx.d.jitsu.com" or a proxy base like "/api/jitsu". */
  host: string;
  /** Server write key. Sent as the `X-Write-Key` header (s2s only). Omit when proxying. */
  writeKey?: string;
  /** "client" (browser) or "s2s" (server-to-server). Default: "client". */
  mode?: "client" | "s2s";
  /** Jitsu event-type path segment. Default: "track". */
  eventTypePath?: "page" | "track" | "identify" | "group" | "event";
  /** Override the destination URL builder. Receives the event-type path segment. */
  endpoint?: (type: string) => string;
  /** Custom fetch implementation (defaults to global fetch). */
  fetchImpl?: typeof fetch;
}

export interface WarehouseNativeLoggerOptions {
  /** Where to send data. */
  destination:
    | ({ type: "segment" } & { analytics: AnalyticsLike })
    | ({ type: "rudderstack" } & { analytics: AnalyticsLike })
    | JitsuDestination
    | {
        type: "custom";
        /** @deprecated Use `assignmentHandler`. Kept for back-compat. */
        handler?: AssignmentLogger;
        /** Handler for structured assignment rows. */
        assignmentHandler?: AssignmentLogger;
        /** Handler for full events (exposure/track/decision). */
        eventHandler?: TrackableEventLogger;
      };
  /** Event name used for assignment rows (default: "Experiment Assignment"). */
  eventName?: string;
  /** Maps a full event (exposure/track/decision) to a destination event name. */
  eventNameFor?: (event: TrackableEvent) => string;
}

const DEFAULT_ASSIGNMENT_EVENT_NAME = "Experiment Assignment";

/** Flattens an AssignmentLogEntry to the snake_case shape used by warehouse syncs. */
function toAssignmentProps(entry: AssignmentLogEntry): Record<string, unknown> {
  return {
    unit_key: entry.unitKey,
    policy_id: entry.policyId,
    allocation_name: entry.allocationName,
    timestamp: entry.timestamp,
    layer_id: entry.layerId,
    allocation_id: entry.allocationId,
    org_id: entry.orgId,
    project_id: entry.projectId,
    env: entry.env,
    type: entry.type,
    decision_id: entry.decisionId,
    anonymous_id: entry.anonymousId,
    assignment_id: entry.id,
    ...entry.properties,
  };
}

/** Default destination event name for a full event. */
function defaultEventName(event: TrackableEvent): string {
  switch (event.type) {
    case "exposure":
      return "traffical_exposure";
    case "decision":
      return "traffical_decision";
    case "track":
    default:
      return event.event;
  }
}

/** Flattens a full event to a properties object suitable for analytics/Jitsu. */
function toEventProps(event: TrackableEvent): Record<string, unknown> {
  const common: Record<string, unknown> = {
    unit_key: event.unitKey,
    org_id: event.orgId,
    project_id: event.projectId,
    env: event.env,
    type: event.type,
    event_id: event.id,
  };

  if (event.type === "track") {
    return {
      ...common,
      decision_id: event.decisionId,
      value: event.value,
      ...event.properties,
    };
  }

  // exposure | decision
  return {
    ...common,
    decision_id: event.type === "exposure" ? event.decisionId : event.id,
    assignments: event.assignments,
    ...(event.context ?? {}),
  };
}

/** Builds a Jitsu/Segment envelope for a track-style payload. */
function jitsuEnvelope(
  eventName: string,
  identity: { unitKey: string; anonymousId?: string; messageId?: string; timestamp?: string },
  properties: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: "track",
    event: eventName,
    userId: identity.unitKey,
    anonymousId: identity.anonymousId,
    messageId: identity.messageId,
    timestamp: identity.timestamp ?? new Date().toISOString(),
    properties,
  };
}

/** Creates a sender that POSTs Segment-compatible payloads to Jitsu. */
function createJitsuSender(dest: JitsuDestination): (body: Record<string, unknown>) => void {
  const fetchImpl = dest.fetchImpl ?? (globalThis.fetch as typeof fetch | undefined);
  const typePath = dest.eventTypePath ?? "track";
  const buildUrl = dest.endpoint
    ? dest.endpoint
    : (type: string) =>
        `${dest.host.replace(/\/$/, "")}/api/s/${dest.mode === "s2s" ? "s2s/" : ""}${type}`;
  const url = buildUrl(typePath);

  return (body: Record<string, unknown>) => {
    if (!fetchImpl) return;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (dest.writeKey) headers["X-Write-Key"] = dest.writeKey;
    try {
      void fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        // Best-effort delivery on page unload in browsers.
        keepalive: true,
      }).catch(() => {
        // Swallow network errors — BYO delivery is best-effort.
      });
    } catch {
      // Swallow synchronous errors (e.g. fetch unavailable).
    }
  };
}

/**
 * Creates both an `assignmentLogger` and an `eventLogger` for the configured
 * destination. Pass either (or both) to the TrafficalClient options.
 *
 * @example
 * ```ts
 * const { assignmentLogger, eventLogger } = createWarehouseNativeLogger({
 *   destination: { type: "jitsu", host: "/api/jitsu", mode: "s2s" },
 * });
 * ```
 */
export function createWarehouseNativeLogger(options: WarehouseNativeLoggerOptions): {
  assignmentLogger: AssignmentLogger;
  eventLogger: TrackableEventLogger;
} {
  const dest = options.destination;
  const assignmentEventName = options.eventName ?? DEFAULT_ASSIGNMENT_EVENT_NAME;
  const nameFor = options.eventNameFor ?? defaultEventName;

  if (dest.type === "custom") {
    const assignmentHandler = dest.assignmentHandler ?? dest.handler;
    return {
      assignmentLogger: (entry) => assignmentHandler?.(entry),
      eventLogger: (event) => dest.eventHandler?.(event),
    };
  }

  if (dest.type === "jitsu") {
    const send = createJitsuSender(dest);
    return {
      assignmentLogger: (entry) =>
        send(
          jitsuEnvelope(
            assignmentEventName,
            { unitKey: entry.unitKey, anonymousId: entry.anonymousId, messageId: entry.id, timestamp: entry.timestamp },
            toAssignmentProps(entry),
          ),
        ),
      eventLogger: (event) =>
        send(
          jitsuEnvelope(
            nameFor(event),
            { unitKey: event.unitKey, messageId: event.id, timestamp: event.timestamp },
            toEventProps(event),
          ),
        ),
    };
  }

  // segment | rudderstack
  const analytics = dest.analytics;
  return {
    assignmentLogger: (entry) => analytics.track(assignmentEventName, toAssignmentProps(entry)),
    eventLogger: (event) => analytics.track(nameFor(event), toEventProps(event)),
  };
}

/**
 * Creates an AssignmentLogger that routes structured assignment entries
 * to Segment, Rudderstack, Jitsu, or a custom handler.
 *
 * Back-compat wrapper around {@link createWarehouseNativeLogger}.
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
  return createWarehouseNativeLogger(options).assignmentLogger;
}
