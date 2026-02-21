// Re-export everything from core
export * from "@traffical/core";

// Re-export client utilities (excluding browser-specific: DOM plugin, LocalStorageProvider)
export {
  TrafficalClient,
  type TrafficalClientOptions,
  type LifecycleProvider,
  type VisibilityState,
  type VisibilityCallback,
  type StorageProvider,
  MemoryStorageProvider,
  type TrafficalPlugin,
  type PluginOptions,
  ErrorBoundary,
  type ErrorBoundaryOptions,
} from "@traffical/js-client";

// RN-specific exports
export {
  TrafficalRNClient,
  type TrafficalRNClientOptions,
} from "./client.js";
export {
  createPreloadedAsyncStorage,
  type PreloadedAsyncStorageProvider,
} from "./storage.js";
export { createRNLifecycleProvider } from "./lifecycle.js";
export { type DeviceInfo, type DeviceInfoProvider } from "./device-info.js";

// Provider and hooks
export {
  TrafficalRNProvider,
  type TrafficalRNProviderProps,
} from "./provider.js";
export {
  TrafficalContext,
  useTrafficalContext,
  type TrafficalRNProviderConfig,
  type TrafficalContextValue,
} from "./context.js";
export {
  useTraffical,
  type UseTrafficalOptions,
  type UseTrafficalResult,
  useTrafficalTrack,
  useTrafficalPlugin,
  useTrafficalClient,
} from "./hooks.js";
