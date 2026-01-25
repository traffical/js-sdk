/**
 * ErrorBoundary - Ensures SDK never crashes customer's application.
 *
 * Wraps all public methods to catch errors and return safe defaults.
 * Optionally reports errors to Traffical backend for monitoring.
 */

export interface ErrorBoundaryOptions {
  /** Whether to report errors to Traffical backend */
  reportErrors?: boolean;
  /** Endpoint for error reporting */
  errorEndpoint?: string;
  /** SDK key for identification */
  sdkKey?: string;
  /** Callback when error occurs */
  onError?: (tag: string, error: Error) => void;
}

export class ErrorBoundary {
  private _seen = new Set<string>();
  private _options: ErrorBoundaryOptions;
  private _lastError: Error | null = null;

  constructor(options: ErrorBoundaryOptions = {}) {
    this._options = options;
  }

  /**
   * Wrap a synchronous function to catch errors and return fallback.
   */
  capture<T>(tag: string, fn: () => T, fallback: T): T {
    try {
      return fn();
    } catch (error) {
      this._onError(tag, error);
      return fallback;
    }
  }

  /**
   * Wrap an async function to catch errors and return fallback.
   */
  async captureAsync<T>(tag: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      this._onError(tag, error);
      return fallback;
    }
  }

  /**
   * Execute an async operation without expecting a return value.
   * Used for fire-and-forget operations like event tracking.
   */
  async swallow(tag: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this._onError(tag, error);
    }
  }

  /**
   * Get the last error that occurred (for debugging).
   */
  getLastError(): Error | null {
    const error = this._lastError;
    this._lastError = null;
    return error;
  }

  /**
   * Clear the seen errors set (for testing or session reset).
   */
  clearSeen(): void {
    this._seen.clear();
  }

  private _onError(tag: string, error: unknown): void {
    const resolvedError = this._resolveError(error);
    this._lastError = resolvedError;

    // Deduplicate - only handle each unique error once
    const errorKey = `${tag}:${resolvedError.name}:${resolvedError.message}`;
    if (this._seen.has(errorKey)) {
      return;
    }
    this._seen.add(errorKey);

    // Log to console (development)
    console.warn(`[Traffical] Error in ${tag}:`, resolvedError.message);

    // Call user-provided callback
    this._options.onError?.(tag, resolvedError);

    // Optionally report to backend
    if (this._options.reportErrors && this._options.errorEndpoint) {
      this._reportError(tag, resolvedError).catch(() => {
        // Silently fail - we don't want error reporting to cause errors
      });
    }
  }

  private async _reportError(tag: string, error: Error): Promise<void> {
    if (!this._options.errorEndpoint) return;

    try {
      await fetch(this._options.errorEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this._options.sdkKey && { "X-Traffical-Key": this._options.sdkKey }),
        },
        body: JSON.stringify({
          tag,
          error: error.name,
          message: error.message,
          stack: error.stack,
          timestamp: new Date().toISOString(),
          sdk: "@traffical/js-client",
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
        }),
      });
    } catch {
      // Silently fail
    }
  }

  private _resolveError(error: unknown): Error {
    if (error instanceof Error) {
      return error;
    }
    if (typeof error === "string") {
      return new Error(error);
    }
    return new Error("An unknown error occurred");
  }
}

