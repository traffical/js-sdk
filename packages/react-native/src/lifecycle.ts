import { AppState, type AppStateStatus } from "react-native";
import type {
  LifecycleProvider,
  VisibilityCallback,
} from "@traffical/js-client";

export function createRNLifecycleProvider(): LifecycleProvider {
  const listeners: VisibilityCallback[] = [];

  AppState.addEventListener("change", (nextState: AppStateStatus) => {
    const visibility = nextState === "active" ? "foreground" : "background";
    for (const cb of listeners) cb(visibility);
  });

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
  };
}
