import { AppState, type AppStateStatus } from "react-native";
import type {
  LifecycleProvider,
  VisibilityCallback,
} from "@traffical/js-client";

/**
 * A LifecycleProvider that also owns the native AppState subscription and can
 * tear it down. `dispose()` removes the underlying `AppState` listener so the
 * provider (and the client that owns it) can be fully garbage-collected — the
 * base `LifecycleProvider` contract has no teardown verb, so we widen it here.
 */
export interface DisposableLifecycleProvider extends LifecycleProvider {
  /** Remove the native AppState subscription and drop all callbacks. */
  dispose(): void;
}

/** Shape of the value returned by RN's `AppState.addEventListener`. */
interface AppStateSubscription {
  remove(): void;
}

export function createRNLifecycleProvider(): DisposableLifecycleProvider {
  const listeners: VisibilityCallback[] = [];

  const handleChange = (nextState: AppStateStatus): void => {
    const visibility = nextState === "active" ? "foreground" : "background";
    for (const cb of listeners) cb(visibility);
  };

  // RN >= 0.65 returns a subscription object with `.remove()`. Older RN returned
  // `undefined` and required `AppState.removeEventListener` — we keep a handle so
  // either way the subscription is torn down in `dispose()` (no leak, no
  // dangling handler firing into a destroyed client).
  const subscription = AppState.addEventListener(
    "change",
    handleChange
  ) as AppStateSubscription | undefined;

  return {
    onVisibilityChange(callback: VisibilityCallback): void {
      listeners.push(callback);
    },
    removeVisibilityListener(callback: VisibilityCallback): void {
      const idx = listeners.indexOf(callback);
      if (idx !== -1) listeners.splice(idx, 1);
    },
    isUnloading(): boolean {
      return false;
    },
    dispose(): void {
      listeners.length = 0;
      if (subscription && typeof subscription.remove === "function") {
        subscription.remove();
      } else {
        // Legacy RN fallback (< 0.65): no subscription object was returned.
        const legacy = AppState as unknown as {
          removeEventListener?: (
            type: "change",
            handler: (state: AppStateStatus) => void
          ) => void;
        };
        legacy.removeEventListener?.("change", handleChange);
      }
    },
  };
}
