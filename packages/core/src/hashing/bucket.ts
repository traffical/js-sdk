/**
 * Bucket Computation
 *
 * Deterministic bucket assignment for traffic splitting.
 * The bucket is computed as: hash(unitKeyValue + ":" + layerId) % bucketCount
 *
 * This ensures:
 * - Same user always gets same bucket for a given layer
 * - Different layers can have independent bucketing (orthogonality)
 * - Deterministic results across SDK and server
 */

import { fnv1a } from "./fnv1a.js";

/**
 * Computes the bucket for a given unit and layer.
 *
 * @param unitKeyValue - The value of the unit key (e.g., userId value)
 * @param layerId - The layer ID for orthogonal bucketing
 * @param bucketCount - Total number of buckets (e.g., 1000)
 * @returns Bucket number in range [0, bucketCount - 1]
 */
export function computeBucket(
  unitKeyValue: string,
  layerId: string,
  bucketCount: number
): number {
  // Concatenate unit key and layer ID with separator
  const input = `${unitKeyValue}:${layerId}`;

  // Use FNV-1a for consistent hashing
  const hash = fnv1a(input);

  // Map to bucket range
  return hash % bucketCount;
}

/**
 * Checks if a bucket falls within a range.
 *
 * @param bucket - The computed bucket
 * @param range - [start, end] inclusive range
 * @returns True if bucket is in range
 */
export function isInBucketRange(
  bucket: number,
  range: [number, number]
): boolean {
  return bucket >= range[0] && bucket <= range[1];
}

/**
 * Finds which allocation matches a given bucket.
 *
 * @param bucket - The computed bucket
 * @param allocations - Array of allocations with bucket ranges
 * @returns The matching allocation, or null if none match
 */
export function findMatchingAllocation<
  T extends { bucketRange: [number, number] }
>(bucket: number, allocations: T[]): T | null {
  for (const allocation of allocations) {
    if (isInBucketRange(bucket, allocation.bucketRange)) {
      return allocation;
    }
  }
  return null;
}

/**
 * Converts a percentage to a bucket range.
 *
 * @param percentage - Traffic percentage (0-100)
 * @param bucketCount - Total buckets
 * @param startBucket - Starting bucket (default 0)
 * @returns [start, end] bucket range
 */
export function percentageToBucketRange(
  percentage: number,
  bucketCount: number,
  startBucket = 0
): [number, number] {
  const bucketsNeeded = Math.floor((percentage / 100) * bucketCount);
  const endBucket = Math.min(startBucket + bucketsNeeded - 1, bucketCount - 1);
  return [startBucket, endBucket];
}

/**
 * Creates non-overlapping bucket ranges for multiple variants.
 *
 * @param percentages - Array of percentages that should sum to <= 100
 * @param bucketCount - Total buckets
 * @returns Array of [start, end] bucket ranges
 */
export function createBucketRanges(
  percentages: number[],
  bucketCount: number
): [number, number][] {
  const ranges: [number, number][] = [];
  let currentBucket = 0;

  for (const percentage of percentages) {
    if (percentage <= 0) continue;

    const bucketsNeeded = Math.floor((percentage / 100) * bucketCount);
    if (bucketsNeeded > 0) {
      const endBucket = currentBucket + bucketsNeeded - 1;
      ranges.push([currentBucket, endBucket]);
      currentBucket = endBucket + 1;
    }
  }

  return ranges;
}

