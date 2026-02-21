import { describe, it, expect, beforeEach, mock } from "bun:test";

// Mock react-native AppState before importing
type AppStateCallback = (state: string) => void;
let appStateListeners: AppStateCallback[] = [];

mock.module("react-native", () => ({
  AppState: {
    addEventListener: mock((_event: string, callback: AppStateCallback) => {
      appStateListeners.push(callback);
      return { remove: () => {} };
    }),
  },
}));

const { createRNLifecycleProvider } = await import("../lifecycle.js");

describe("createRNLifecycleProvider", () => {
  beforeEach(() => {
    appStateListeners = [];
  });

  it("should create a valid LifecycleProvider", () => {
    const provider = createRNLifecycleProvider();

    expect(provider.onVisibilityChange).toBeFunction();
    expect(provider.removeVisibilityListener).toBeFunction();
    expect(provider.isUnloading).toBeFunction();
  });

  it("should always return false for isUnloading", () => {
    const provider = createRNLifecycleProvider();
    expect(provider.isUnloading()).toBe(false);
  });

  it("should fire foreground callback when AppState becomes active", () => {
    const provider = createRNLifecycleProvider();
    const callback = mock((_state: "foreground" | "background") => {});

    provider.onVisibilityChange(callback);

    // Simulate AppState change to active
    for (const listener of appStateListeners) {
      listener("active");
    }

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("foreground");
  });

  it("should fire background callback when AppState becomes background", () => {
    const provider = createRNLifecycleProvider();
    const callback = mock((_state: "foreground" | "background") => {});

    provider.onVisibilityChange(callback);

    for (const listener of appStateListeners) {
      listener("background");
    }

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("background");
  });

  it("should fire background callback when AppState becomes inactive", () => {
    const provider = createRNLifecycleProvider();
    const callback = mock((_state: "foreground" | "background") => {});

    provider.onVisibilityChange(callback);

    for (const listener of appStateListeners) {
      listener("inactive");
    }

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("background");
  });

  it("should support multiple listeners", () => {
    const provider = createRNLifecycleProvider();
    const cb1 = mock((_state: "foreground" | "background") => {});
    const cb2 = mock((_state: "foreground" | "background") => {});

    provider.onVisibilityChange(cb1);
    provider.onVisibilityChange(cb2);

    for (const listener of appStateListeners) {
      listener("active");
    }

    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it("should remove listeners correctly", () => {
    const provider = createRNLifecycleProvider();
    const cb1 = mock((_state: "foreground" | "background") => {});
    const cb2 = mock((_state: "foreground" | "background") => {});

    provider.onVisibilityChange(cb1);
    provider.onVisibilityChange(cb2);
    provider.removeVisibilityListener(cb1);

    for (const listener of appStateListeners) {
      listener("active");
    }

    expect(cb1).toHaveBeenCalledTimes(0);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it("should handle removing a non-existent listener gracefully", () => {
    const provider = createRNLifecycleProvider();
    const cb = mock((_state: "foreground" | "background") => {});

    // Should not throw
    provider.removeVisibilityListener(cb);
  });
});
