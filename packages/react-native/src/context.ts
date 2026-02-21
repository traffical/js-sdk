import { createContext, useContext } from "react";
import type { TrafficalClient, TrafficalPlugin } from "@traffical/js-client";
import type { ConfigBundle, Context } from "@traffical/core";

export interface TrafficalRNProviderConfig {
  orgId: string;
  projectId: string;
  env: string;
  apiKey: string;

  baseUrl?: string;
  localConfig?: ConfigBundle;
  refreshIntervalMs?: number;

  unitKeyFn?: () => string;
  contextFn?: () => Context;

  trackDecisions?: boolean;
  decisionDeduplicationTtlMs?: number;
  exposureSessionTtlMs?: number;

  plugins?: TrafficalPlugin[];

  eventBatchSize?: number;
  eventFlushIntervalMs?: number;

  initialParams?: Record<string, unknown>;

  /** Evaluation mode (default: "server" for RN) */
  evaluationMode?: "bundle" | "server";
  /** Device info provider for enriching context */
  deviceInfoProvider?: import("./device-info.js").DeviceInfoProvider;
  /** Cache max age in ms for persisted server responses (default: 86400000 = 24 hours) */
  cacheMaxAgeMs?: number;
}

export interface TrafficalContextValue {
  client: TrafficalClient | null;
  ready: boolean;
  error: Error | null;
  getUnitKey: () => string;
  getContext: () => Context;
  initialParams?: Record<string, unknown>;
  localConfig?: ConfigBundle;
}

export const TrafficalContext = createContext<TrafficalContextValue | null>(
  null
);

export function useTrafficalContext(): TrafficalContextValue {
  const context = useContext(TrafficalContext);
  if (!context) {
    throw new Error(
      "useTrafficalContext must be used within a TrafficalRNProvider"
    );
  }
  return context;
}
