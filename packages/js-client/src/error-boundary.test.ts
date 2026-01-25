import { describe, test, expect, spyOn } from "bun:test";
import { ErrorBoundary } from "./error-boundary";

describe("ErrorBoundary", () => {
  test("capture returns result on success", () => {
    const eb = new ErrorBoundary();
    const result = eb.capture("test", () => "success", "fallback");
    expect(result).toBe("success");
  });

  test("capture returns fallback on error", () => {
    const eb = new ErrorBoundary();
    const result = eb.capture(
      "test",
      () => {
        throw new Error("boom");
      },
      "fallback"
    );
    expect(result).toBe("fallback");
  });

  test("captureAsync returns result on success", async () => {
    const eb = new ErrorBoundary();
    const result = await eb.captureAsync("test", async () => "success", "fallback");
    expect(result).toBe("success");
  });

  test("captureAsync returns fallback on error", async () => {
    const eb = new ErrorBoundary();
    const result = await eb.captureAsync(
      "test",
      async () => {
        throw new Error("boom");
      },
      "fallback"
    );
    expect(result).toBe("fallback");
  });

  test("deduplicates errors with same message", () => {
    const eb = new ErrorBoundary();
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    // First error logs
    eb.capture("test", () => { throw new Error("boom"); }, null);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // Same error doesn't log again
    eb.capture("test", () => { throw new Error("boom"); }, null);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // Different error logs
    eb.capture("test", () => { throw new Error("different"); }, null);
    expect(warnSpy).toHaveBeenCalledTimes(2);

    warnSpy.mockRestore();
  });

  test("calls onError callback", () => {
    let capturedTag = "";
    let capturedError: Error | null = null;

    const eb = new ErrorBoundary({
      onError: (tag, error) => {
        capturedTag = tag;
        capturedError = error;
      },
    });

    eb.capture("myTag", () => { throw new Error("test error"); }, null);

    expect(capturedTag).toBe("myTag");
    expect(capturedError?.message).toBe("test error");
  });

  test("getLastError returns and clears last error", () => {
    const eb = new ErrorBoundary();
    spyOn(console, "warn").mockImplementation(() => {});

    eb.capture("test", () => { throw new Error("boom"); }, null);
    
    const error = eb.getLastError();
    expect(error?.message).toBe("boom");
    
    // Second call returns null (cleared)
    expect(eb.getLastError()).toBeNull();
  });
});

