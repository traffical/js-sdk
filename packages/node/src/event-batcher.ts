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

import type { TrackableEvent } from "@traffical/core";

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_FLUSH_INTERVAL_MS = 30_000; // 30 seconds

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
  /** Callback on flush error */
  onError?: (error: Error) => void;
  /** Enable debug logging */
  debug?: boolean;
}

export class EventBatcher {
  private readonly _endpoint: string;
  private readonly _apiKey: string;
  private readonly _batchSize: number;
  private readonly _flushIntervalMs: number;
  private readonly _onError?: (error: Error) => void;
  private readonly _debug: boolean;

  private _queue: TrackableEvent[] = [];
  private _flushTimer: ReturnType<typeof setInterval> | null = null;
  private _isFlushing = false;
  private _isDestroyed = false;

  constructor(options: EventBatcherOptions) {
    this._endpoint = options.endpoint;
    this._apiKey = options.apiKey;
    this._batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this._flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this._onError = options.onError;
    this._debug = options.debug ?? false;

    // Start flush timer
    this._startFlushTimer();
  }

  /**
   * Log an event (added to batch queue).
   */
  log(event: TrackableEvent): void {
    if (this._isDestroyed) {
      this._log("Attempted to log event after destroy, ignoring");
      return;
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
      this._log(`Flushed ${events.length} events successfully`);
    } catch (error) {
      // Put events back in queue for retry (at the front)
      this._queue.unshift(...events);
      this._log(`Flush failed, ${events.length} events re-queued`);
      this._onError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this._isFlushing = false;
    }
  }

  /**
   * Get the number of events in the queue.
   */
  get queueSize(): number {
    return this._queue.length;
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

