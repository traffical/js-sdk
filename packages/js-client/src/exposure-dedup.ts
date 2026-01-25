/**
 * ExposureDeduplicator - Prevents duplicate exposure events.
 *
 * Same user seeing same variant should only count as 1 exposure.
 * Uses session-based deduplication with localStorage persistence.
 */

import type { StorageProvider } from "./storage.js";

const STORAGE_KEY = "exposure_dedup";
const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface ExposureDeduplicatorOptions {
  /** Storage provider for persistence */
  storage: StorageProvider;
  /** Session TTL in milliseconds (default: 30 minutes) */
  sessionTtlMs?: number;
}

interface DeduplicationState {
  /** Set of seen exposure keys */
  seen: string[];
  /** Session start timestamp */
  sessionStart: number;
}

export class ExposureDeduplicator {
  private _storage: StorageProvider;
  private _sessionTtlMs: number;
  private _seen: Set<string>;
  private _sessionStart: number;

  constructor(options: ExposureDeduplicatorOptions) {
    this._storage = options.storage;
    this._sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this._seen = new Set();
    this._sessionStart = Date.now();

    // Restore from storage
    this._restore();
  }

  /**
   * Generate a deduplication key for an exposure.
   *
   * Key format: {unitKey}:{policyId}:{variant}
   */
  static createKey(unitKey: string, policyId: string, variant: string): string {
    return `${unitKey}:${policyId}:${variant}`;
  }

  /**
   * Check if an exposure should be tracked (not a duplicate).
   * Returns true if this is a new exposure, false if duplicate.
   */
  shouldTrack(key: string): boolean {
    // Check if session has expired
    if (this._isSessionExpired()) {
      this._resetSession();
    }

    if (this._seen.has(key)) {
      return false;
    }

    // Mark as seen
    this._seen.add(key);
    this._persist();

    return true;
  }

  /**
   * Check and mark in one operation.
   * Returns true if this was a new exposure (and is now marked as seen).
   */
  checkAndMark(unitKey: string, policyId: string, variant: string): boolean {
    const key = ExposureDeduplicator.createKey(unitKey, policyId, variant);
    return this.shouldTrack(key);
  }

  /**
   * Clear all seen exposures (useful for testing or logout).
   */
  clear(): void {
    this._seen.clear();
    this._storage.remove(STORAGE_KEY);
  }

  /**
   * Get the number of unique exposures in the current session.
   */
  get size(): number {
    return this._seen.size;
  }

  private _isSessionExpired(): boolean {
    return Date.now() - this._sessionStart > this._sessionTtlMs;
  }

  private _resetSession(): void {
    this._seen.clear();
    this._sessionStart = Date.now();
    this._storage.remove(STORAGE_KEY);
  }

  private _persist(): void {
    const state: DeduplicationState = {
      seen: Array.from(this._seen),
      sessionStart: this._sessionStart,
    };
    this._storage.set(STORAGE_KEY, state, this._sessionTtlMs);
  }

  private _restore(): void {
    const state = this._storage.get<DeduplicationState>(STORAGE_KEY);
    if (!state) return;

    // Check if stored session is still valid
    const sessionAge = Date.now() - state.sessionStart;
    if (sessionAge > this._sessionTtlMs) {
      this._storage.remove(STORAGE_KEY);
      return;
    }

    // Restore state
    this._seen = new Set(state.seen);
    this._sessionStart = state.sessionStart;
  }
}

