import { useState, useEffect, useCallback, useRef } from "react";
import type {
  ParameterValue,
  DecisionResult,
  Context,
} from "@traffical/core";
import { resolveParameters } from "@traffical/core";
import type { TrafficalPlugin } from "@traffical/js-client";
import { useTrafficalContext } from "./context.js";

// =============================================================================
// Internal Utilities
// =============================================================================

function createStableKey(obj: unknown): string {
  if (obj === null || obj === undefined) {
    return String(obj);
  }
  if (typeof obj !== "object") {
    return String(obj);
  }
  return JSON.stringify(obj, Object.keys(obj as object).sort());
}

function useStableObject<T>(obj: T): T {
  const stableKey = createStableKey(obj);
  const ref = useRef(obj);
  if (createStableKey(ref.current) !== stableKey) {
    ref.current = obj;
  }
  return ref.current;
}

// =============================================================================
// useTraffical - Primary Hook
// =============================================================================

export interface UseTrafficalOptions<T> {
  defaults: T;
  context?: Context;
  /**
   * Tracking mode (default: "full")
   * - "full": Track decision + exposure (default, recommended for UI)
   * - "decision": Track decision only, manual exposure control
   * - "none": No tracking (internal logic, tests)
   */
  tracking?: "full" | "decision" | "none";
}

export interface BoundTrackOptions {
  properties?: Record<string, unknown>;
}

export interface UseTrafficalResult<T> {
  params: T;
  decision: DecisionResult | null;
  ready: boolean;
  error: Error | null;
  trackExposure: () => void;
  track: (event: string, properties?: Record<string, unknown>) => void;
  flushEvents: () => Promise<void>;
}

export function useTraffical<T extends Record<string, ParameterValue>>(
  options: UseTrafficalOptions<T>
): UseTrafficalResult<T> {
  const {
    client,
    ready,
    error,
    getContext,
    getUnitKey,
    initialParams,
    localConfig,
  } = useTrafficalContext();

  const trackingMode = options.tracking ?? "full";
  const shouldTrackDecision = trackingMode !== "none";
  const shouldAutoTrackExposure = trackingMode === "full";

  const stableDefaults = useStableObject(options.defaults);
  const stableContext = useStableObject(options.context);

  const resolvedSyncRef = useRef(false);
  const syncDecisionRef = useRef<DecisionResult | null>(null);

  const [params, setParams] = useState<T>(() => {
    if (client && ready) {
      resolvedSyncRef.current = true;

      const context: Context = {
        ...getContext(),
        ...(options.context ?? {}),
      };

      if (shouldTrackDecision) {
        const result = client.decide({ context, defaults: options.defaults });
        syncDecisionRef.current = result;
        return result.assignments as T;
      } else {
        return client.getParams({ context, defaults: options.defaults }) as T;
      }
    }

    if (localConfig) {
      try {
        const context = getContext();
        if (context.userId) {
          resolvedSyncRef.current = true;
          const fullContext: Context = {
            ...context,
            ...(options.context ?? {}),
          };
          const resolved = resolveParameters(
            localConfig,
            fullContext,
            options.defaults
          );
          return resolved as T;
        }
      } catch {
        // Fall through to defaults
      }
    }

    if (initialParams) {
      return { ...stableDefaults, ...initialParams } as T;
    }
    return stableDefaults;
  });

  const [decision, setDecision] = useState<DecisionResult | null>(
    () => syncDecisionRef.current
  );
  const [hasTrackedExposure, setHasTrackedExposure] = useState(false);

  const trackExposure = useCallback(() => {
    if (trackingMode === "none") return;
    if (!client || !decision || hasTrackedExposure) return;
    client.trackExposure(decision);
    setHasTrackedExposure(true);
  }, [client, decision, hasTrackedExposure, trackingMode]);

  useEffect(() => {
    if (!client || !ready) return;

    if (resolvedSyncRef.current && syncDecisionRef.current) {
      resolvedSyncRef.current = false;
      return;
    }
    resolvedSyncRef.current = false;

    const context: Context = {
      ...getContext(),
      ...stableContext,
    };

    if (shouldTrackDecision) {
      const result = client.decide({ context, defaults: stableDefaults });
      setParams(result.assignments as T);
      setDecision(result);
      setHasTrackedExposure(false);
    } else {
      const resolved = client.getParams({
        context,
        defaults: stableDefaults,
      });
      setParams(resolved as T);
      setDecision(null);
    }
  }, [
    client,
    ready,
    getContext,
    stableContext,
    stableDefaults,
    shouldTrackDecision,
  ]);

  useEffect(() => {
    if (shouldAutoTrackExposure && decision && !hasTrackedExposure) {
      trackExposure();
    }
  }, [shouldAutoTrackExposure, decision, hasTrackedExposure, trackExposure]);

  const decisionRef = useRef<DecisionResult | null>(null);
  decisionRef.current = decision;

  const pendingTracksRef = useRef<
    Array<{ event: string; properties?: Record<string, unknown> }>
  >([]);

  useEffect(() => {
    if (decision && client && pendingTracksRef.current.length > 0) {
      const pending = pendingTracksRef.current;
      pendingTracksRef.current = [];

      for (const { event, properties } of pending) {
        client.track(event, properties, {
          decisionId: decision.decisionId,
          unitKey: getUnitKey(),
        });
      }
    }
  }, [decision, client, getUnitKey]);

  const track = useCallback(
    (event: string, properties?: Record<string, unknown>) => {
      if (!client) {
        console.warn(
          "[Traffical] Client not initialized, cannot track event"
        );
        return;
      }

      const currentDecision = decisionRef.current;
      if (!currentDecision) {
        if (trackingMode === "none") {
          console.warn(
            "[Traffical] Cannot track event with tracking: 'none'. Use tracking: 'full' or 'decision'."
          );
          return;
        }
        pendingTracksRef.current.push({ event, properties });
        return;
      }

      client.track(event, properties, {
        decisionId: currentDecision.decisionId,
        unitKey: getUnitKey(),
      });
    },
    [client, getUnitKey, trackingMode]
  );

  const flushEvents = useCallback(async () => {
    if (!client) return;
    await client.flushEvents();
  }, [client]);

  return {
    params,
    decision,
    ready,
    error,
    trackExposure,
    track,
    flushEvents,
  };
}

// =============================================================================
// useTrafficalTrack
// =============================================================================

export function useTrafficalTrack() {
  const { client, getUnitKey } = useTrafficalContext();

  const track = useCallback(
    (
      event: string,
      properties?: Record<string, unknown>,
      options?: { decisionId?: string }
    ) => {
      if (!client) {
        console.warn(
          "[Traffical] Client not initialized, cannot track event"
        );
        return;
      }

      client.track(event, properties, {
        decisionId: options?.decisionId,
        unitKey: getUnitKey(),
      });
    },
    [client, getUnitKey]
  );

  return track;
}

// =============================================================================
// useTrafficalPlugin
// =============================================================================

export function useTrafficalPlugin<
  T extends TrafficalPlugin = TrafficalPlugin,
>(name: string): T | undefined {
  const { client, ready } = useTrafficalContext();

  if (!client || !ready) {
    return undefined;
  }

  return client.getPlugin(name) as T | undefined;
}

// =============================================================================
// useTrafficalClient
// =============================================================================

export function useTrafficalClient() {
  const { client, ready, error } = useTrafficalContext();
  return { client, ready, error };
}
