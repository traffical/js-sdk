/**
 * EventBatcher - Batched event transport for Node.js environments.
 *
 * Features:
 * - Batches events for efficient network usage
 * - Flushes on batch size or interval (whichever comes first)
 * - Graceful shutdown with final flush
 * - Error handling with configurable callback
 *
 * Unlike the browser EventLogger, this implementation:
 * - Does not use sendBeacon (Node.js doesn't have it)
 * - Does not persist failed events to storage
 * - Uses standard fetch for HTTP requests
 */

import type { TrackableEvent, OnSchemaWarnings, EventBatchResponse } from "@traffical/core";

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_FLUSH_INTERVAL_MS = 30_000; // 30 seconds
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000; // 10 seconds
const DEFAULT_MAX_QUEUE_SIZE = 1_000; // bounded queue; overflow drops oldest
const DEFAULT_MAX_RETRIES = 3; // attempts after the first = 3
const DEFAULT_RETRY_BACKOFF_MS = 250; // exponential: base * 2^(attempt-1)

/**
 * Options for EventBatcher.
 */
export interface EventBatcherOptions {
  /** API endpoint for events */
  endpoint: string;
  /** API key for authentication */
  apiKey: string;
  /** Max events before auto-flush (default: 10) */
  batchSize?: number;
  /** Auto-flush interval in ms (default: 30000) */
  flushIntervalMs?: number;
  /**
   * Timeout in ms for the event batch POST (default: 10000).
   * On timeout the request is aborted and treated like a failed send:
   * events are re-queued for retry.
   */
  requestTimeoutMs?: number;
  /**
   * Maximum number of events buffered in memory (default: 1000). When the
   * queue is full, the OLDEST event is dropped (a counter is bumped) — the
   * queue never grows without bound. Aligns with the Python SDK's model.
   */
  maxQueueSize?: number;
  /**
   * Max retry attempts (after the first) for a transient delivery failure
   * (network error, timeout, 429, 5xx) before the batch is re-queued for a
   * later flush (default: 3).
   */
  maxRetries?: number;
  /** Base for exponential retry backoff in ms: base * 2^(attempt-1) (default: 250). */
  retryBackoffMs?: number;
  /** Callback on flush error */
  onError?: (error: Error) => void;
  /** Enable debug logging */
  debug?: boolean;
  /** Callback when schema validation warnings are received from the edge (dev-mode) */
  onSchemaWarnings?: OnSchemaWarnings;
}

/** Outcome of attempting to deliver one batch. */
type DeliveryOutcome = "delivered" | "dropped" | "disabled" | "retry-later";

export class EventBatcher {
  private readonly _endpoint: string;
  private readonly _apiKey: string;
  private readonly _batchSize: number;
  private readonly _flushIntervalMs: number;
  private readonly _requestTimeoutMs: number;
  private readonly _maxQueueSize: number;
  private readonly _maxRetries: number;
  private readonly _retryBackoffMs: number;
  private readonly _onError?: (error: Error) => void;
  private readonly _onSchemaWarnings?: OnSchemaWarnings;
  private readonly _debug: boolean;

  private _queue: TrackableEvent[] = [];
  private _flushTimer: ReturnType<typeof setInterval> | null = null;
  private _isFlushing = false;
  private _isDestroyed = false;
  /** Permanently true after an HTTP 401 kill-switch fires. */
  private _isDisabled = false;
  /** Count of events dropped because the bounded queue overflowed. */
  private _droppedCount = 0;

  constructor(options: EventBatcherOptions) {
    this._endpoint = options.endpoint;
    this._apiKey = options.apiKey;
    this._batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this._flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this._requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this._maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
    this._maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this._retryBackoffMs = options.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS;
    this._onError = options.onError;
    this._onSchemaWarnings = options.onSchemaWarnings;
    this._debug = options.debug ?? false;

    // Start flush timer
    this._startFlushTimer();
  }

  /**
   * Log an event (added to the bounded batch queue). When the queue is full
   * the OLDEST event is dropped (drop-oldest) so memory can't grow without
   * bound. After a 401 kill-switch, events are silently discarded.
   */
  log(event: TrackableEvent): void {
    if (this._isDestroyed) {
      this._log("Attempted to log event after destroy, ignoring");
      return;
    }
    if (this._isDisabled) {
      // Delivery permanently disabled (401) — stop buffering entirely.
      return;
    }

    // Bounded queue: drop the oldest event on overflow.
    if (this._queue.length >= this._maxQueueSize) {
      this._queue.shift();
      this._droppedCount++;
      this._log(`Queue full, dropped oldest event (dropped total: ${this._droppedCount})`);
    }

    this._queue.push(event);
    this._log(`Event queued (queue size: ${this._queue.length})`);

    // Auto-flush if batch is full
    if (this._queue.length >= this._batchSize) {
      this._log("Batch size reached, flushing");
      this.flush().catch(() => {
        // Errors handled in flush
      });
    }
  }

  /**
   * Flush queued events immediately.
   *
   * Drains the queue in batch-sized chunks. Each batch is delivered with
   * exponential-backoff retry on transient failures (network/timeout/429/5xx).
   * A batch that still fails after `maxRetries` is re-queued at the FRONT
   * (bounded) and draining stops until the next flush. A non-retryable 4xx
   * drops the batch. An HTTP 401 permanently disables delivery and clears the
   * queue (auth kill-switch).
   */
  async flush(): Promise<void> {
    if (this._isFlushing || this._isDisabled || this._queue.length === 0) {
      return;
    }

    this._isFlushing = true;
    try {
      while (this._queue.length > 0 && !this._isDisabled) {
        // Drain a batch OUT of the queue (so concurrent log()s can't alias it).
        const batch = this._queue.splice(0, this._batchSize);
        const outcome = await this._deliverWithRetry(batch);

        if (outcome === "delivered") {
          this._log(`Flushed ${batch.length} events successfully`);
          continue;
        }
        if (outcome === "dropped") {
          continue; // non-retryable rejection; batch discarded
        }
        if (outcome === "disabled") {
          this._queue = []; // 401 kill-switch
          break;
        }
        // retry-later: put the batch back at the front (bounded) and stop.
        this._requeueFront(batch);
        this._log(`Flush failed, ${batch.length} events re-queued`);
        break;
      }
    } finally {
      this._isFlushing = false;
    }
  }

  /**
   * Delivers one batch with bounded exponential-backoff retry.
   * onError fires exactly once per batch that ends in a retry-later.
   */
  private async _deliverWithRetry(batch: TrackableEvent[]): Promise<DeliveryOutcome> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this._maxRetries; attempt++) {
      if (attempt > 0) {
        // Stop retrying inline once we're shutting down; the batch is
        // re-queued and best-effort flushed by the caller.
        if (this._isDestroyed) break;
        await this._sleep(this._retryBackoffMs * 2 ** (attempt - 1));
      }

      let status: number;
      try {
        status = await this._sendEvents(batch);
      } catch (error) {
        // Network error / abort (timeout) — transient, retry.
        lastError = error instanceof Error ? error : new Error(String(error));
        continue;
      }

      if (status >= 200 && status < 300) return "delivered";
      if (status === 401) {
        this._disable();
        return "disabled";
      }
      if (status === 429 || status >= 500) {
        lastError = new Error(`HTTP ${status}`);
        continue; // transient, retry
      }
      // Other 4xx — permanent rejection, drop the batch.
      this._onError?.(
        new Error(`HTTP ${status}: batch rejected, dropping ${batch.length} events`)
      );
      return "dropped";
    }

    if (lastError) this._onError?.(lastError);
    return "retry-later";
  }

  /** Re-queues a failed batch at the front, dropping oldest on overflow. */
  private _requeueFront(batch: TrackableEvent[]): void {
    this._queue.unshift(...batch);
    while (this._queue.length > this._maxQueueSize) {
      this._queue.shift();
      this._droppedCount++;
    }
  }

  private _disable(): void {
    if (this._isDisabled) return;
    this._isDisabled = true;
    this._queue = [];
    console.warn(
      "[Traffical] API key rejected (HTTP 401); event delivery disabled for this client"
    );
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      if (typeof (t as { unref?: () => void }).unref === "function") {
        (t as { unref: () => void }).unref();
      }
    });
  }

  /**
   * Get the number of events in the queue.
   */
  get queueSize(): number {
    return this._queue.length;
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
   * Check if the batcher is destroyed.
   */
  get isDestroyed(): boolean {
    return this._isDestroyed;
  }

  /**
   * Destroy the batcher (cleanup timers and flush remaining events).
   */
  async destroy(): Promise<void> {
    if (this._isDestroyed) {
      return;
    }

    this._isDestroyed = true;

    // Stop timer
    if (this._flushTimer) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
    }

    // Final flush
    if (this._queue.length > 0) {
      this._log(`Destroying with ${this._queue.length} events in queue, flushing`);
      await this.flush();
    }
  }

  /**
   * Synchronous destroy (for process exit handlers).
   * Does not wait for flush to complete.
   */
  destroySync(): void {
    this._isDestroyed = true;

    if (this._flushTimer) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
    }

    // Attempt to flush but don't wait
    if (this._queue.length > 0) {
      this.flush().catch(() => {
        // Best effort on shutdown
      });
    }
  }

  /**
   * Sends one batch and returns the HTTP status code. Throws only on a
   * transport-level failure (network error / abort), which the caller treats
   * as a transient, retryable error. HTTP status classification (2xx / 401 /
   * 4xx / 5xx) is done by the caller.
   */
  private async _sendEvents(events: TrackableEvent[]): Promise<number> {
    // Abort the request if the edge hangs so the flush settles and events
    // go down the re-queue-for-retry path (same as any network failure).
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
        const body = (await response.json()) as EventBatchResponse;
        if (body.schemaWarnings && body.schemaWarnings.length > 0) {
          this._onSchemaWarnings(body.schemaWarnings);
        }
      } catch {
        // Response parsing is best-effort for dev-mode warnings
      }
    }

    return response.status;
  }

  private _startFlushTimer(): void {
    if (this._flushIntervalMs <= 0) {
      return;
    }

    this._flushTimer = setInterval(() => {
      if (this._queue.length > 0) {
        this.flush().catch(() => {
          // Errors handled in flush
        });
      }
    }, this._flushIntervalMs);

    // Unref the timer so it doesn't keep the process alive
    // This is important for Node.js servers that need to shutdown gracefully
    if (typeof this._flushTimer.unref === "function") {
      this._flushTimer.unref();
    }
  }

  private _log(message: string): void {
    if (this._debug) {
      console.log(`[Traffical EventBatcher] ${message}`);
    }
  }
}

