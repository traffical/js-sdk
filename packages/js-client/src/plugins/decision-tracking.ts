/**
 * DecisionTrackingPlugin - Automatically tracks decision events.
 *
 * This plugin hooks into the SDK's decision lifecycle and sends a DecisionEvent
 * to the control plane whenever decide() is called. This enables:
 * - Intent-to-treat analysis: tracking all assignments, not just exposures
 * - Debugging: understanding why specific values were computed
 * - Audit trail: tracking all decisions made by the SDK
 *
 * Decision events are deduplicated: the same user seeing the same assignment
 * will only trigger one event within the deduplication TTL.
 */

import type { TrafficalPlugin } from "./types.js";
import type { DecisionResult, DecisionEvent, ParameterValue } from "@traffical/core";
import { DecisionDeduplicator } from "@traffical/core";

const SDK_NAME = "js-client";
const SDK_VERSION = "0.1.0"; // Should match package.json version

/**
 * Options for the DecisionTrackingPlugin.
 */
export interface DecisionTrackingPluginOptions {
  /**
   * Disable decision tracking entirely.
   * Default: false (tracking enabled)
   */
  disabled?: boolean;

  /**
   * Time-to-live for deduplication in milliseconds.
   * Same user+assignment combination won't be tracked again within this window.
   * Default: 1 hour (3600000 ms)
   */
  deduplicationTtlMs?: number;
}

/**
 * Dependencies injected by the SDK client.
 */
export interface DecisionTrackingPluginDeps {
  /** Organization ID */
  orgId: string;
  /** Project ID */
  projectId: string;
  /** Environment */
  env: string;
  /**
   * Function to log a decision event.
   * This is typically the EventLogger.log() method.
   */
  log: (event: DecisionEvent) => void;
}

/**
 * Creates a DecisionTrackingPlugin instance.
 *
 * @param options - Plugin configuration options
 * @param deps - Dependencies injected by the SDK client
 * @returns A TrafficalPlugin that tracks decision events
 *
 * @example
 * ```typescript
 * const plugin = createDecisionTrackingPlugin(
 *   { disabled: false },
 *   {
 *     orgId: "org_123",
 *     projectId: "proj_456",
 *     env: "production",
 *     log: (event) => eventLogger.log(event),
 *   }
 * );
 * ```
 */
export function createDecisionTrackingPlugin(
  options: DecisionTrackingPluginOptions,
  deps: DecisionTrackingPluginDeps
): TrafficalPlugin {
  const dedup = new DecisionDeduplicator({
    ttlMs: options.deduplicationTtlMs,
  });

  return {
    name: "decision-tracking",

    onDecision(decision: DecisionResult): void {
      // Skip if disabled
      if (options.disabled) {
        return;
      }

      // Skip if no unit key (can't attribute)
      const unitKey = decision.metadata.unitKeyValue;
      if (!unitKey) {
        return;
      }

      // Hash assignments for deduplication
      const hash = DecisionDeduplicator.hashAssignments(
        decision.assignments as Record<string, ParameterValue>
      );

      // Check deduplication
      if (!dedup.checkAndMark(unitKey, hash)) {
        return; // Duplicate, skip
      }

      // Build the decision event
      const event: DecisionEvent = {
        type: "decision",
        id: decision.decisionId,
        orgId: deps.orgId,
        projectId: deps.projectId,
        env: deps.env,
        unitKey,
        timestamp: decision.metadata.timestamp,
        assignments: decision.assignments,
        layers: decision.metadata.layers,
        // Include filtered context if available (for contextual bandit training)
        context: decision.metadata.filteredContext,
        sdkName: SDK_NAME,
        sdkVersion: SDK_VERSION,
      };

      // Log the event
      deps.log(event);
    },

    onDestroy(): void {
      // Clear the deduplication cache
      dedup.clear();
    },
  };
}

