/**
 * Contextual Scoring Unit Tests
 *
 * Tests the pure scoring functions in isolation.
 */

import { describe, test, expect } from "bun:test";
import {
  computeAllocationScore,
  softmaxProbabilities,
  applyProbabilityFloor,
} from "./contextual.js";
import type { BundleAllocationCoefficients } from "../types/index.js";

describe("computeAllocationScore", () => {
  test("returns intercept when no features", () => {
    const coefficients: BundleAllocationCoefficients = {
      intercept: 1.5,
      numeric: [],
      categorical: [],
    };
    expect(computeAllocationScore(coefficients, {})).toBe(1.5);
  });

  test("computes numeric feature contribution", () => {
    const coefficients: BundleAllocationCoefficients = {
      intercept: 0.5,
      numeric: [{ key: "score", coef: 0.3, missing: 0 }],
      categorical: [],
    };
    expect(computeAllocationScore(coefficients, { score: 10 })).toBeCloseTo(3.5, 10);
  });

  test("uses missing value for absent numeric feature", () => {
    const coefficients: BundleAllocationCoefficients = {
      intercept: 0.0,
      numeric: [{ key: "score", coef: 0.3, missing: -0.5 }],
      categorical: [],
    };
    expect(computeAllocationScore(coefficients, {})).toBeCloseTo(-0.5, 10);
  });

  test("uses missing value for non-numeric context value", () => {
    const coefficients: BundleAllocationCoefficients = {
      intercept: 0.0,
      numeric: [{ key: "score", coef: 0.3, missing: -0.5 }],
      categorical: [],
    };
    expect(computeAllocationScore(coefficients, { score: "not_a_number" })).toBeCloseTo(-0.5, 10);
  });

  test("computes categorical feature contribution", () => {
    const coefficients: BundleAllocationCoefficients = {
      intercept: 0.0,
      numeric: [],
      categorical: [
        { key: "device", values: { mobile: 0.8, desktop: -0.2 }, missing: 0 },
      ],
    };
    expect(computeAllocationScore(coefficients, { device: "mobile" })).toBeCloseTo(0.8, 10);
    expect(computeAllocationScore(coefficients, { device: "desktop" })).toBeCloseTo(-0.2, 10);
  });

  test("uses missing value for unknown categorical value", () => {
    const coefficients: BundleAllocationCoefficients = {
      intercept: 0.0,
      numeric: [],
      categorical: [
        { key: "device", values: { mobile: 0.8, desktop: -0.2 }, missing: 0.1 },
      ],
    };
    expect(computeAllocationScore(coefficients, { device: "smartwatch" })).toBeCloseTo(0.1, 10);
  });

  test("uses missing value for absent categorical feature", () => {
    const coefficients: BundleAllocationCoefficients = {
      intercept: 0.0,
      numeric: [],
      categorical: [
        { key: "device", values: { mobile: 0.8, desktop: -0.2 }, missing: 0.1 },
      ],
    };
    expect(computeAllocationScore(coefficients, {})).toBeCloseTo(0.1, 10);
  });

  test("computes combined score with multiple features", () => {
    const coefficients: BundleAllocationCoefficients = {
      intercept: 0.5,
      numeric: [
        { key: "engagement_score", coef: 0.3, missing: 0 },
      ],
      categorical: [
        { key: "device_type", values: { mobile: 0.8, desktop: -0.2 }, missing: 0 },
      ],
    };
    // 0.5 + 0.3*8 + 0.8 = 3.7
    expect(
      computeAllocationScore(coefficients, { engagement_score: 8, device_type: "mobile" })
    ).toBeCloseTo(3.7, 10);
  });
});

describe("softmaxProbabilities", () => {
  test("returns [1.0] for single score", () => {
    const result = softmaxProbabilities([5.0], 1.0);
    expect(result).toEqual([1.0]);
  });

  test("returns empty array for empty input", () => {
    const result = softmaxProbabilities([], 1.0);
    expect(result).toEqual([]);
  });

  test("equal scores produce uniform distribution", () => {
    const result = softmaxProbabilities([1.0, 1.0, 1.0], 1.0);
    for (const p of result) {
      expect(p).toBeCloseTo(1 / 3, 5);
    }
  });

  test("dominant score produces near-1.0 probability", () => {
    const result = softmaxProbabilities([0, 10, 0], 1.0);
    expect(result[1]).toBeGreaterThan(0.99);
    expect(result[0]).toBeLessThan(0.005);
    expect(result[2]).toBeLessThan(0.005);
  });

  test("probabilities sum to 1.0", () => {
    const result = softmaxProbabilities([0.0, 3.7, 0.0], 1.0);
    const sum = result.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });

  test("lower gamma makes distribution more peaked", () => {
    const highGamma = softmaxProbabilities([0, 1, 0], 2.0);
    const lowGamma = softmaxProbabilities([0, 1, 0], 0.5);
    // With lower gamma, the peak should be higher
    expect(lowGamma[1]).toBeGreaterThan(highGamma[1]);
  });

  test("very small gamma does not produce NaN", () => {
    const result = softmaxProbabilities([0, 1, 0], 0.0001);
    for (const p of result) {
      expect(Number.isNaN(p)).toBe(false);
      expect(Number.isFinite(p)).toBe(true);
    }
  });
});

describe("applyProbabilityFloor", () => {
  test("returns empty array for empty input", () => {
    expect(applyProbabilityFloor([], 0.05)).toEqual([]);
  });

  test("does not change probabilities above the floor", () => {
    const probs = [0.3, 0.4, 0.3];
    const result = applyProbabilityFloor(probs, 0.05);
    const sum = result.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
    expect(result[0]).toBeCloseTo(0.3, 5);
    expect(result[1]).toBeCloseTo(0.4, 5);
    expect(result[2]).toBeCloseTo(0.3, 5);
  });

  test("raises probabilities below the floor and renormalizes", () => {
    const probs = [0.01, 0.98, 0.01];
    const result = applyProbabilityFloor(probs, 0.05);
    // Both 0.01 should be raised to 0.05
    expect(result[0]).toBeGreaterThanOrEqual(0.05 / 1.1); // After renormalization
    expect(result[2]).toBeGreaterThanOrEqual(0.05 / 1.1);
    const sum = result.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });

  test("floor of 0 does not change probabilities", () => {
    const probs = [0.01, 0.98, 0.01];
    const result = applyProbabilityFloor(probs, 0);
    expect(result).toEqual(probs);
  });

  test("floor is clamped to 1/n to avoid impossible distributions", () => {
    const probs = [0.1, 0.8, 0.1];
    // Floor of 0.5 with 3 allocations would be impossible, clamped to 1/3.
    // After clamping [0.1->0.333, 0.8, 0.1->0.333] and renormalizing,
    // the low entries are raised above their original values.
    const result = applyProbabilityFloor(probs, 0.5);
    const sum = result.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
    // The previously-low entries should be higher than their original 0.1
    expect(result[0]).toBeGreaterThan(0.1);
    expect(result[2]).toBeGreaterThan(0.1);
    // The dominant entry should still be the largest
    expect(result[1]).toBeGreaterThan(result[0]);
  });
});
