/**
 * Re-export smoke test.
 *
 * The warehouse-native logger implementation (and its full behavioural suite)
 * lives in `@traffical/core-io`. These tests only assert that js-client's
 * public import paths still resolve to it, so a browser consumer's
 * `import { createWarehouseNativeLogger } from "@traffical/js-client"` keeps
 * working after the move.
 */

import { describe, test, expect, mock } from "bun:test";
import type { AssignmentLogEntry } from "@traffical/core";
import {
  createWarehouseNativeLogger,
  createWarehouseNativeLoggerPlugin,
} from "./warehouse-native-logger.ts";
import * as pluginsIndex from "./index.ts";
import * as packageIndex from "../index.ts";

const entry: AssignmentLogEntry = {
  unitKey: "u1",
  policyId: "pol_1",
  policyKey: "checkout-test",
  allocationName: "treatment",
  allocationKey: "treatment-key",
  timestamp: "2025-01-01T00:00:00.000Z",
  layerId: "layer_1",
  allocationId: "alloc_1",
  orgId: "org_1",
  projectId: "proj_1",
  env: "production",
  type: "decision",
};

describe("js-client warehouse-native logger re-export", () => {
  test("both factories are exported from the module, plugins index, and package index", () => {
    for (const mod of [{ createWarehouseNativeLogger, createWarehouseNativeLoggerPlugin }, pluginsIndex, packageIndex]) {
      expect(typeof mod.createWarehouseNativeLogger).toBe("function");
      expect(typeof mod.createWarehouseNativeLoggerPlugin).toBe("function");
    }
  });

  test("the re-exported factory emits the stable warehouse-join keys", () => {
    const track = mock(() => {});
    packageIndex.createWarehouseNativeLoggerPlugin({
      destination: { type: "segment", analytics: { track } },
    })(entry);
    expect(track.mock.calls[0]?.[1]).toMatchObject({
      policy_id: "pol_1",
      policy_key: "checkout-test",
      allocation_name: "treatment",
      allocation_key: "treatment-key",
    });
  });
});
