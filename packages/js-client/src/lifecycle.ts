export type VisibilityState = "foreground" | "background";
export type VisibilityCallback = (state: VisibilityState) => void;

export interface LifecycleProvider {
  onVisibilityChange(callback: VisibilityCallback): void;
  removeVisibilityListener(callback: VisibilityCallback): void;
  /** Whether the page/app is in the process of unloading (browser-only concept). */
  isUnloading(): boolean;
}

export function createBrowserLifecycleProvider(): LifecycleProvider {
  const listeners: VisibilityCallback[] = [];
  let unloading = false;

  function notify(state: VisibilityState): void {
    for (const cb of listeners) cb(state);
  }

  const onPageHide = (): void => {
    unloading = true;
    notify("background");
  };

  const onVisibilityChange = (): void => {
    if (typeof document !== "undefined") {
      notify(document.visibilityState === "hidden" ? "background" : "foreground");
    }
  };

  const onBeforeUnload = (): void => {
    unloading = true;
    notify("background");
  };

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
  }
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  return {
    onVisibilityChange(callback: VisibilityCallback): void {
      listeners.push(callback);
    },
    removeVisibilityListener(callback: VisibilityCallback): void {
      const idx = listeners.indexOf(callback);
      if (idx !== -1) listeners.splice(idx, 1);
    },
    isUnloading(): boolean {
      return unloading;
    },
  };
}
