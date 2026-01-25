/**
 * Traffical React Provider
 *
 * Initializes the Traffical client (browser-optimized) and provides it to child components.
 * Supports plugins, automatic stable ID, and decision tracking out of the box.
 */

import React, {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import {
  TrafficalClient,
  createTrafficalClientSync,
} from "@traffical/js-client";
import type { Context } from "@traffical/core";
import {
  TrafficalContext,
  type TrafficalProviderConfig,
  type TrafficalContextValue,
} from "./context.js";

/**
 * Props for the TrafficalProvider component.
 */
export interface TrafficalProviderProps {
  /** Configuration for the Traffical client */
  config: TrafficalProviderConfig;
  /** Child components */
  children: ReactNode;
}

/**
 * TrafficalProvider - initializes and provides the Traffical client to React components.
 *
 * Features:
 * - Browser-optimized with sendBeacon, localStorage persistence
 * - Automatic stable ID for anonymous users (unless unitKeyFn provided)
 * - Plugin system support (DecisionTrackingPlugin enabled by default)
 * - Decision and exposure deduplication
 *
 * @example
 * ```tsx
 * <TrafficalProvider
 *   config={{
 *     orgId: "org_123",
 *     projectId: "proj_456",
 *     env: "production",
 *     apiKey: "pk_...",
 *     // Optional: provide unitKeyFn for logged-in users
 *     unitKeyFn: () => getUserId(),
 *     // Optional: add context
 *     contextFn: () => ({ locale: "en-US" }),
 *     // Optional: add custom plugins
 *     plugins: [createDOMBindingPlugin()],
 *   }}
 * >
 *   <App />
 * </TrafficalProvider>
 * ```
 */
export function TrafficalProvider({
  config,
  children,
}: TrafficalProviderProps): React.ReactElement {
  const [client, setClient] = useState<TrafficalClient | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Keep a ref to the client for cleanup
  const clientRef = useRef<TrafficalClient | null>(null);

  // Memoize the unit key function
  // If no unitKeyFn is provided, use the client's stable ID
  const getUnitKey = useCallback(() => {
    if (config.unitKeyFn) {
      return config.unitKeyFn();
    }
    // Fall back to the client's auto-generated stable ID
    return clientRef.current?.getStableId() ?? "";
  }, [config.unitKeyFn]);

  const getContext = useCallback((): Context => {
    const unitKey = getUnitKey();
    const additionalContext = config.contextFn?.() ?? {};

    // The unit key field name comes from the bundle's hashing config
    // For now, we use common conventions and let the SDK handle it
    return {
      ...additionalContext,
      // Include common unit key field names
      userId: unitKey,
      deviceId: unitKey,
      anonymousId: unitKey,
    };
  }, [getUnitKey, config.contextFn]);

  // Initialize client on mount
  useEffect(() => {
    let mounted = true;

    const initClient = async () => {
      try {
        // Create client synchronously so it's available immediately
        const newClient = createTrafficalClientSync({
          orgId: config.orgId,
          projectId: config.projectId,
          env: config.env,
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          localConfig: config.localConfig,
          refreshIntervalMs: config.refreshIntervalMs,
          trackDecisions: config.trackDecisions,
          decisionDeduplicationTtlMs: config.decisionDeduplicationTtlMs,
          exposureSessionTtlMs: config.exposureSessionTtlMs,
          eventBatchSize: config.eventBatchSize,
          eventFlushIntervalMs: config.eventFlushIntervalMs,
          plugins: config.plugins,
        });

        clientRef.current = newClient;

        if (mounted) {
          setClient(newClient);
          // If localConfig was provided, mark as ready immediately
          if (config.localConfig) {
            setReady(true);
          }
        }

        // Initialize asynchronously (fetches/refreshes config bundle)
        await newClient.initialize();

        if (mounted) {
          setReady(true);
        }
      } catch (err) {
        if (mounted) {
          setError(
            err instanceof Error ? err : new Error(String(err))
          );
          // Still mark as ready - we'll use defaults
          setReady(true);
        }
      }
    };

    initClient();

    return () => {
      mounted = false;
      clientRef.current?.destroy();
      clientRef.current = null;
    };
  }, [
    config.orgId,
    config.projectId,
    config.env,
    config.apiKey,
    config.baseUrl,
    config.localConfig,
    config.refreshIntervalMs,
    config.trackDecisions,
    config.decisionDeduplicationTtlMs,
    config.exposureSessionTtlMs,
    config.eventBatchSize,
    config.eventFlushIntervalMs,
    config.plugins,
  ]);

  // Memoize context value
  const contextValue = useMemo<TrafficalContextValue>(
    () => ({
      client,
      ready,
      error,
      getUnitKey,
      getContext,
      initialParams: config.initialParams,
      localConfig: config.localConfig,
    }),
    [client, ready, error, getUnitKey, getContext, config.initialParams, config.localConfig]
  );

  return (
    <TrafficalContext.Provider value={contextValue}>
      {children}
    </TrafficalContext.Provider>
  );
}
