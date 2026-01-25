/**
 * DecisionDeduplicator - Pure decision deduplication logic.
 *
 * Tracks which user+assignment combinations have been seen to avoid
 * sending duplicate decision events. This enables efficient decision
 * tracking without overwhelming the event pipeline.
 *
 * Key differences from ExposureDeduplicator:
 * - Pure in-memory (no I/O, no storage dependency)
 * - Deduplicates on unitKey + assignment hash (not policy/variant)
 * - Suitable for use in any JavaScript environment
 */

import type { ParameterValue } from "../types/index.js";

const DEFAULT_TTL_MS = 3600_000; // 1 hour
const DEFAULT_MAX_ENTRIES = 10_000;
const CLEANUP_THRESHOLD = 0.2; // Clean when 20% of entries are expired

export interface DecisionDeduplicatorOptions {
  /**
   * Time-to-live for deduplication entries in milliseconds.
   * After this time, the same decision can be tracked again.
   * Default: 1 hour (3600000 ms)
   */
  ttlMs?: number;
  /**
   * Maximum number of entries to store.
   * When exceeded, oldest entries are removed.
   * Default: 10000
   */
  maxEntries?: number;
}

export class DecisionDeduplicator {
  private _seen = new Map<string, number>(); // key -> timestamp
  private readonly _ttlMs: number;
  private readonly _maxEntries: number;
  private _lastCleanup = Date.now();

  constructor(options: DecisionDeduplicatorOptions = {}) {
    this._ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this._maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  /**
   * Generate a stable hash for assignment values.
   * Used to create a deduplication key from assignments.
   */
  static hashAssignments(assignments: Record<string, ParameterValue>): string {
    // Sort keys for deterministic ordering
    const sortedKeys = Object.keys(assignments).sort();
    const parts: string[] = [];

    for (const key of sortedKeys) {
      const value = assignments[key];
      // Simple string representation that's stable
      const valueStr = typeof value === "object" ? JSON.stringify(value) : String(value);
      parts.push(`${key}=${valueStr}`);
    }

    return parts.join("|");
  }

  /**
   * Create a deduplication key from unitKey and assignment hash.
   */
  static createKey(unitKey: string, assignmentHash: string): string {
    return `${unitKey}:${assignmentHash}`;
  }

  /**
   * Check if this decision is new (not seen before within TTL).
   * If new, marks it as seen.
   *
   * @param unitKey - The unit key (user identifier)
   * @param assignmentHash - Hash of the assignments (from hashAssignments)
   * @returns true if this is a new decision, false if duplicate
   */
  checkAndMark(unitKey: string, assignmentHash: string): boolean {
    const key = DecisionDeduplicator.createKey(unitKey, assignmentHash);
    const now = Date.now();
    const lastSeen = this._seen.get(key);

    // Check if we've seen this within TTL
    if (lastSeen !== undefined && now - lastSeen < this._ttlMs) {
      return false; // Duplicate
    }

    // Mark as seen
    this._seen.set(key, now);

    // Periodic cleanup
    this._maybeCleanup(now);

    return true; // New decision
  }

  /**
   * Check if a decision would be considered new (without marking it).
   */
  wouldBeNew(unitKey: string, assignmentHash: string): boolean {
    const key = DecisionDeduplicator.createKey(unitKey, assignmentHash);
    const now = Date.now();
    const lastSeen = this._seen.get(key);

    if (lastSeen === undefined) {
      return true;
    }

    return now - lastSeen >= this._ttlMs;
  }

  /**
   * Clear all seen decisions.
   */
  clear(): void {
    this._seen.clear();
  }

  /**
   * Get the number of entries in the deduplication cache.
   */
  get size(): number {
    return this._seen.size;
  }

  /**
   * Perform cleanup of expired entries.
   * Called periodically based on CLEANUP_THRESHOLD.
   */
  private _maybeCleanup(now: number): void {
    // Only cleanup periodically, not on every call
    const timeSinceCleanup = now - this._lastCleanup;
    const shouldCleanup =
      timeSinceCleanup > this._ttlMs * CLEANUP_THRESHOLD || this._seen.size > this._maxEntries;

    if (!shouldCleanup) {
      return;
    }

    this._lastCleanup = now;
    this._cleanup(now);
  }

  /**
   * Remove expired entries and enforce max size.
   */
  private _cleanup(now: number): void {
    const expiredKeys: string[] = [];

    // Find expired entries
    for (const [key, timestamp] of this._seen.entries()) {
      if (now - timestamp >= this._ttlMs) {
        expiredKeys.push(key);
      }
    }

    // Remove expired entries
    for (const key of expiredKeys) {
      this._seen.delete(key);
    }

    // If still over max, remove oldest entries
    if (this._seen.size > this._maxEntries) {
      const entries = Array.from(this._seen.entries()).sort((a, b) => a[1] - b[1]); // Sort by timestamp

      const toRemove = entries.slice(0, this._seen.size - this._maxEntries);
      for (const [key] of toRemove) {
        this._seen.delete(key);
      }
    }
  }
}

