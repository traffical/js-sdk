/**
 * Tests for the adapter-facing bundle accessors used by wrappers such as the
 * OpenFeature provider:
 * - getUnitKeyField(bundle)      → the field the bundle buckets on
 * - getParameterLayerId(bundle)  → the layer a parameter belongs to
 */

import { describe, test, expect } from "bun:test";
import type { ConfigBundle } from "../types/index.js";
import { getUnitKeyField, getParameterLayerId } from "./engine.js";

const bundle: ConfigBundle = {
  version: "2026-01-01T00:00:00Z",
  orgId: "org_1",
  projectId: "proj_1",
  env: "production",
  hashing: { unitKey: "userId", bucketCount: 1000 },
  parameters: [
    { key: "ui.color", type: "string", default: "#000", layerId: "layer_a", namespace: "ui" },
    { key: "price.discount", type: "number", default: 0, layerId: "layer_b", namespace: "price" },
  ],
  layers: [
    { id: "layer_a", policies: [] },
    { id: "layer_b", policies: [] },
  ],
};

describe("getUnitKeyField", () => {
  test("returns the bundle's hashing unit key", () => {
    expect(getUnitKeyField(bundle)).toBe("userId");
  });

  test("returns null for a null bundle", () => {
    expect(getUnitKeyField(null)).toBeNull();
  });
});

describe("getParameterLayerId", () => {
  test("returns the owning layer id for a known parameter", () => {
    expect(getParameterLayerId(bundle, "ui.color")).toBe("layer_a");
    expect(getParameterLayerId(bundle, "price.discount")).toBe("layer_b");
  });

  test("returns null for an unknown parameter", () => {
    expect(getParameterLayerId(bundle, "does.not.exist")).toBeNull();
  });

  test("returns null for a null bundle", () => {
    expect(getParameterLayerId(null, "ui.color")).toBeNull();
  });
});
