/**
 * EventLogger - Smart event batching with browser-specific features.
 *
 * Features:
 * - Batches events (flush every N events or M seconds)
 * - Uses navigator.sendBeacon() on page unload
 * - Persists failed events to localStorage
 * - Retries failed events on next session
 * - Visibility-aware: flushes on visibilitychange to hidden
 */

import type { TrackableEvent } from "@traffical/core";
import type { StorageProvider } from "./storage.js";

const FAILED_EVENTS_KEY = "failed_events";
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_FLUSH_INTERVAL_MS = 30_000; // 30 seconds
const MAX_FAILED_EVENTS = 100;

export interface EventLoggerOptions {
  /** API endpoint for events */
  endpoint: string;
  /** API key for authentication */
  apiKey: string;
  /** Storage provider for failed events */
  storage: StorageProvider;
  /** Max events before auto-flush (default: 10) */
  batchSize?: number;
  /** Auto-flush interval in ms (default: 30000) */
  flushIntervalMs?: number;
  /** Callback on flush error */
  onError?: (error: Error) => void;
}

export class EventLogger {
  private _endpoint: string;
  private _apiKey: string;
  private _storage: StorageProvider;
  private _batchSize: number;
  private _flushIntervalMs: number;
  private _onError?: (error: Error) => void;

  private _queue: TrackableEvent[] = [];
  private _flushTimer: ReturnType<typeof setTimeout> | null = null;
  private _isFlushing = false;

  constructor(options: EventLoggerOptions) {
    this._endpoint = options.endpoint;
    this._apiKey = options.apiKey;
    this._storage = options.storage;
    this._batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this._flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this._onError = options.onError;

    // Set up browser event listeners
    this._setupListeners();

    // Retry failed events from previous session
    this._retryFailedEvents();

    // Start flush timer
    this._startFlushTimer();
  }

  /**
   * Log an event (added to batch queue).
   */
  log(event: TrackableEvent): void {
    this._queue.push(event);

    // Auto-flush if batch is full
    if (this._queue.length >= this._batchSize) {
      this.flush();
    }
  }

  /**
   * Flush all queued events immediately.
   */
  async flush(): Promise<void> {
    if (this._isFlushing || this._queue.length === 0) {
      return;
    }

    this._isFlushing = true;

    // Take current queue
    const events = [...this._queue];
    this._queue = [];

    try {
      await this._sendEvents(events);
    } catch (error) {
      // Persist failed events for retry
      this._persistFailedEvents(events);
      this._onError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this._isFlushing = false;
    }
  }

  /**
   * Flush using fetch with keepalive (for page unload).
   * 
   * We use fetch with keepalive: true instead of sendBeacon because:
   * - sendBeacon cannot send custom headers (like Authorization)
   * - keepalive ensures the request completes even as the page unloads
   * - Same reliability guarantees as sendBeacon
   * 
   * Returns true if request was initiated, false otherwise.
   */
  flushBeacon(): boolean {
    if (this._queue.length === 0) {
      return true;
    }

    if (typeof fetch === "undefined") {
      // Fetch not available - try async flush
      this.flush();
      return false;
    }

    const events = [...this._queue];
    this._queue = [];

    // Use fetch with keepalive instead of sendBeacon
    // This allows us to include the Authorization header
    fetch(this._endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this._apiKey}`,
      },
      body: JSON.stringify({ events }),
      keepalive: true,
    }).catch(() => {
      // Persist for retry on next session
      this._persistFailedEvents(events);
    });

    return true;
  }

  /**
   * Get the number of events in the queue.
   */
  get queueSize(): number {
    return this._queue.length;
  }

  /**
   * Destroy the logger (cleanup timers and listeners).
   */
  destroy(): void {
    if (this._flushTimer) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
    }
    this._removeListeners();
  }

  private async _sendEvents(events: TrackableEvent[]): Promise<void> {
    const response = await fetch(this._endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this._apiKey}`,
      },
      body: JSON.stringify({ events }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  }

  private _persistFailedEvents(events: TrackableEvent[]): void {
    const existing = this._storage.get<TrackableEvent[]>(FAILED_EVENTS_KEY) ?? [];

    // Limit total stored events
    const combined = [...existing, ...events].slice(-MAX_FAILED_EVENTS);

    this._storage.set(FAILED_EVENTS_KEY, combined);
  }

  private _retryFailedEvents(): void {
    const failed = this._storage.get<TrackableEvent[]>(FAILED_EVENTS_KEY);
    if (!failed || failed.length === 0) {
      return;
    }

    // Clear stored events
    this._storage.remove(FAILED_EVENTS_KEY);

    // Add to queue for retry
    this._queue.push(...failed);
  }

  private _startFlushTimer(): void {
    if (this._flushIntervalMs <= 0) return;

    this._flushTimer = setInterval(() => {
      this.flush().catch(() => {
        // Errors handled in flush
      });
    }, this._flushIntervalMs);
  }

  private _setupListeners(): void {
    if (typeof window === "undefined") return;

    // Flush on page hide (covers tab close, navigation, etc.)
    window.addEventListener("pagehide", this._onPageHide);

    // Flush when page becomes hidden (tab switch, minimize)
    document.addEventListener("visibilitychange", this._onVisibilityChange);

    // Fallback: beforeunload for older browsers
    window.addEventListener("beforeunload", this._onBeforeUnload);
  }

  private _removeListeners(): void {
    if (typeof window === "undefined") return;

    window.removeEventListener("pagehide", this._onPageHide);
    document.removeEventListener("visibilitychange", this._onVisibilityChange);
    window.removeEventListener("beforeunload", this._onBeforeUnload);
  }

  private _onPageHide = (): void => {
    this.flushBeacon();
  };

  private _onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") {
      this.flushBeacon();
    }
  };

  private _onBeforeUnload = (): void => {
    this.flushBeacon();
  };
}

