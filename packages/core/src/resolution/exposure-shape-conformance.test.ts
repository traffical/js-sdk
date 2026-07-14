/**
 * S4 exposure-event SHAPE conformance.
 *
 * Wires `exposure_shape.json` (drift-remediation 0.7.0) through the canonical
 * trackExposure emission algorithm shared by the clients:
 *
 *   1. Drop layers with no policy/allocation.
 *   2. Drop `attributionOnly` layers (resolved for attribution, params not
 *      requested by this decision).
 *   3. Drop layers already exposed this session for (unitKey, layerId,
 *      allocationName) — the fixture's declared dedupKey.
 *   4. Emit EXACTLY ONE event carrying the surviving layers plus the FULL,
 *      un-narrowed decision assignments — or ZERO events when nothing survives.
 *
 * This matches the Node reference (`assignments: decision.assignments`
 * unchanged; only `layers` filtered). The fixture was corrected this run so its
 * expected shape aligns with Node's full-assignments + filtered-layers output.
 */
import { describe, test, expect } from "bun:test";
import { loadSpecFixture } from "./spec-fixtures.js";

interface ResolvedLayer {
  layerId: string;
  policyId?: string;
  allocationName?: string;
  attributionOnly?: boolean;
  [k: string]: unknown;
}

interface ExposureShapeCase {
  name: string;
  unitKey: string;
  assignments: Record<string, unknown>;
  resolvedLayers: ResolvedLayer[];
  alreadyExposed: Array<{ layerId: string; allocationName: string }>;
  expectedEvents: Array<{
    unitKey: string;
    assignments: Record<string, unknown>;
    layers: ResolvedLayer[];
  }>;
}

interface ExposureShapeFixture {
  dedupKey: string;
  testCases: ExposureShapeCase[];
}

/**
 * Canonical exposure emission: returns the zero-or-one events trackExposure()
 * must emit for this decision + session dedup state.
 */
function emitExposureEvents(tc: ExposureShapeCase): Array<{
  unitKey: string;
  assignments: Record<string, unknown>;
  layers: ResolvedLayer[];
}> {
  const seen = new Set(
    tc.alreadyExposed.map((r) => `${tc.unitKey}:${r.layerId}:${r.allocationName}`)
  );

  const exposedLayers: ResolvedLayer[] = [];
  for (const layer of tc.resolvedLayers) {
    if (!layer.policyId || !layer.allocationName) continue;
    if (layer.attributionOnly) continue;
    if (seen.has(`${tc.unitKey}:${layer.layerId}:${layer.allocationName}`)) continue;
    exposedLayers.push(layer);
  }

  if (exposedLayers.length === 0) return [];
  return [
    {
      unitKey: tc.unitKey,
      // FULL assignment map, NOT narrowed to the surviving layers.
      assignments: tc.assignments,
      layers: exposedLayers,
    },
  ];
}

describe("S4: exposure-event shape (exposure_shape.json)", () => {
  const fixture = loadSpecFixture<ExposureShapeFixture>("exposure_shape");

  test("dedupKey is (unitKey, layerId, allocationName)", () => {
    expect(fixture.dedupKey).toBe("(unitKey, layerId, allocationName)");
  });

  for (const tc of fixture.testCases) {
    test(tc.name, () => {
      const events = emitExposureEvents(tc);

      // Exactly the fixture's event count (0 or 1).
      expect(events).toHaveLength(tc.expectedEvents.length);

      for (let i = 0; i < tc.expectedEvents.length; i++) {
        const got = events[i]!;
        const want = tc.expectedEvents[i]!;
        expect(got.unitKey).toBe(want.unitKey);
        // Full, un-narrowed assignment map.
        expect(got.assignments).toEqual(want.assignments);
        // Only layers[] is filtered — order and per-layer fields preserved.
        expect(got.layers).toEqual(want.layers);
      }
    });
  }
});
