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

import type { TrackableEvent, OnSchemaWarnings, EventBatchResponse } from "@traffical/core";
import type { StorageProvider } from "./storage.js";
import type { LifecycleProvider, VisibilityState } from "./lifecycle.js";

const FAILED_EVENTS_KEY = "failed_events";
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_FLUSH_INTERVAL_MS = 30_000; // 30 seconds
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000; // 10 seconds
const MAX_FAILED_EVENTS = 100;
const DEFAULT_MAX_QUEUE_SIZE = 1_000; // bounded in-memory queue; overflow drops oldest

export interface EventLoggerOptions {
  /** API endpoint for events */
  endpoint: string;
  /** API key for authentication */
  apiKey: string;
  /** Storage provider for failed events */
  storage: StorageProvider;
  /** Lifecycle provider for visibility/unload events */
  lifecycleProvider?: LifecycleProvider;
  /** Max events before auto-flush (default: 10) */
  batchSize?: number;
  /** Auto-flush interval in ms (default: 30000) */
  flushIntervalMs?: number;
  /**
   * Maximum number of events buffered in memory before the oldest is dropped
   * (default: 1000). Bounds memory so the queue never grows without limit.
   */
  maxQueueSize?: number;
  /**
   * Timeout in ms for the event batch POST (default: 10000).
   * On timeout the request is aborted and treated like a failed send:
   * events are persisted to storage for retry.
   */
  requestTimeoutMs?: number;
  /** Callback on flush error */
  onError?: (error: Error) => void;
  /** Callback when schema validation warnings are received from the edge (dev-mode) */
  onSchemaWarnings?: OnSchemaWarnings;
}

export class EventLogger {
  private _endpoint: string;
  private _apiKey: string;
  private _storage: StorageProvider;
  private _batchSize: number;
  private _flushIntervalMs: number;
  private _requestTimeoutMs: number;
  private _maxQueueSize: number;
  private _onError?: (error: Error) => void;
  private _onSchemaWarnings?: OnSchemaWarnings;

  private _lifecycleProvider?: LifecycleProvider;
  private _queue: TrackableEvent[] = [];
  private _flushTimer: ReturnType<typeof setTimeout> | null = null;
  private _isFlushing = false;
  /** Permanently true after an HTTP 401 kill-switch fires. */
  private _isDisabled = false;
  /** Count of events dropped because the bounded queue overflowed. */
  private _droppedCount = 0;
  private _visibilityCallback?: (state: VisibilityState) => void;

  constructor(options: EventLoggerOptions) {
    this._endpoint = options.endpoint;
    this._apiKey = options.apiKey;
    this._storage = options.storage;
    this._batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this._flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this._requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this._maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
    this._onError = options.onError;
    this._onSchemaWarnings = options.onSchemaWarnings;
    this._lifecycleProvider = options.lifecycleProvider;

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
    // Delivery permanently disabled (401) — stop buffering entirely.
    if (this._isDisabled) return;

    // Bounded queue: drop the oldest event on overflow.
    if (this._queue.length >= this._maxQueueSize) {
      this._queue.shift();
      this._droppedCount++;
    }

    this._queue.push(event);

    // Auto-flush if batch is full
    if (this._queue.length >= this._batchSize) {
      this.flush();
    }
  }

  /**
   * Flush all queued events immediately.
   *
   * Delivery outcomes:
   * - 2xx: delivered.
   * - Network error / timeout / 429 / 5xx: transient — events persisted for
   *   retry on the next session/visibility change.
   * - HTTP 401: auth kill-switch — delivery is permanently disabled, the queue
   *   and any persisted failed events are cleared.
   * - Other 4xx: permanent rejection — the batch is dropped.
   */
  async flush(): Promise<void> {
    if (this._isFlushing || this._isDisabled || this._queue.length === 0) {
      return;
    }

    this._isFlushing = true;

    // Take current queue
    const events = [...this._queue];
    this._queue = [];

    try {
      const status = await this._sendEvents(events);
      if (status >= 200 && status < 300) {
        return; // delivered
      }
      if (status === 401) {
        this._disable(); // auth kill-switch
        return;
      }
      if (status === 429 || status >= 500) {
        // Transient — persist for retry.
        this._persistFailedEvents(events);
        this._onError?.(new Error(`HTTP ${status}: event delivery failed, will retry`));
        return;
      }
      // Other 4xx — permanent rejection; drop the batch.
      this._onError?.(new Error(`HTTP ${status}: batch rejected, dropping ${events.length} events`));
    } catch (error) {
      // Network error / abort (timeout) — transient, persist for retry.
      this._persistFailedEvents(events);
      this._onError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this._isFlushing = false;
    }
  }

  /** Permanently disable delivery after a 401 and clear all buffered events. */
  private _disable(): void {
    if (this._isDisabled) return;
    this._isDisabled = true;
    this._queue = [];
    this._storage.remove(FAILED_EVENTS_KEY);
    console.warn(
      "[Traffical] API key rejected (HTTP 401); event delivery disabled for this client"
    );
  }

  /** Number of events dropped because the bounded queue overflowed. */
  get droppedCount(): number {
    return this._droppedCount;
  }

  /** True once an HTTP 401 permanently disabled delivery. */
  get isDisabled(): boolean {
    return this._isDisabled;
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
    // This allows us to include the Authorization header.
    // Intentionally no abort timeout here: keepalive requests are meant to
    // outlive the page, and a timer may never fire during unload anyway.
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

  /**
   * Sends one batch and returns the HTTP status code. Throws only on a
   * transport-level failure (network error / abort), which the caller treats
   * as a transient error. HTTP status classification is done by the caller.
   */
  private async _sendEvents(events: TrackableEvent[]): Promise<number> {
    // Abort the request if the edge hangs so the flush settles and events
    // go down the persist-for-retry path (same as any network failure).
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this._requestTimeoutMs);

    let response: Response;
    try {
      response = await fetch(this._endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this._apiKey}`,
        },
        body: JSON.stringify({ events }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      return response.status;
    }

    if (this._onSchemaWarnings) {
      try {
        const body: EventBatchResponse = await response.json();
        if (body.schemaWarnings && body.schemaWarnings.length > 0) {
          this._onSchemaWarnings(body.schemaWarnings);
        }
      } catch {
        // Response parsing is best-effort for dev-mode warnings
      }
    }

    return response.status;
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
    if (!this._lifecycleProvider) return;

    this._visibilityCallback = (state) => {
      if (state === "background") {
        if (this._lifecycleProvider?.isUnloading()) {
          this.flushBeacon();
        } else {
          this.flush().catch(() => {});
        }
      } else {
        this._retryFailedEvents();
      }
    };
    this._lifecycleProvider.onVisibilityChange(this._visibilityCallback);
  }

  private _removeListeners(): void {
    if (this._lifecycleProvider && this._visibilityCallback) {
      this._lifecycleProvider.removeVisibilityListener(this._visibilityCallback);
      this._visibilityCallback = undefined;
    }
  }
}

