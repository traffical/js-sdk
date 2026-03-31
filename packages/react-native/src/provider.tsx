import React, {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type { Context } from "@traffical/core";
import {
  TrafficalContext,
  type TrafficalRNProviderConfig,
  type TrafficalContextValue,
} from "./context.js";
import { TrafficalRNClient } from "./client.js";

export interface TrafficalRNProviderProps {
  config: TrafficalRNProviderConfig;
  children: ReactNode;
  /** Component to render while the SDK is loading (before first resolve completes) */
  loadingComponent?: ReactNode;
}

export function TrafficalRNProvider({
  config,
  children,
  loadingComponent,
}: TrafficalRNProviderProps): React.ReactElement {
  const [client, setClient] = useState<TrafficalRNClient | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [resolveVersion, setResolveVersion] = useState(0);
  const [overrideUnitKey, setOverrideUnitKey] = useState<string | null>(null);
  const [overrideVersion, setOverrideVersion] = useState(0);

  const clientRef = useRef<TrafficalRNClient | null>(null);
  const prevUnitKeyRef = useRef<string | null>(null);

  // Subscribe to identity changes from client.identify()
  useEffect(() => {
    if (!client) return;
    return client.onIdentityChange((newKey) => {
      setOverrideUnitKey(newKey);
    });
  }, [client]);

  // Subscribe to override changes from applyOverrides() / clearOverrides()
  useEffect(() => {
    if (!client) return;
    return client.onOverridesChange(() => {
      setOverrideVersion((v) => v + 1);
    });
  }, [client]);

  const getUnitKey = useCallback(() => {
    if (overrideUnitKey !== null) {
      return overrideUnitKey;
    }
    if (config.unitKeyFn) {
      return config.unitKeyFn();
    }
    return clientRef.current?.getStableId() ?? "";
  }, [overrideUnitKey, config.unitKeyFn]);

  const getContext = useCallback((): Context => {
    const unitKey = getUnitKey();
    const additionalContext = config.contextFn?.() ?? {};
    const deviceInfo = config.deviceInfoProvider?.getDeviceInfo();

    return {
      ...additionalContext,
      ...(deviceInfo ?? {}),
      userId: unitKey,
      deviceId: unitKey,
      anonymousId: unitKey,
    };
  }, [getUnitKey, config.contextFn, config.deviceInfoProvider]);

  useEffect(() => {
    let mounted = true;

    const initClient = async () => {
      try {
        const newClient = new TrafficalRNClient({
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
          evaluationMode: config.evaluationMode ?? "server",
          deviceInfoProvider: config.deviceInfoProvider,
          cacheMaxAgeMs: config.cacheMaxAgeMs,
        });

        clientRef.current = newClient;

        if (mounted) {
          setClient(newClient);
          if (config.localConfig) {
            setReady(true);
          }
        }

        await newClient.initialize();

        if (mounted) {
          setReady(true);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err : new Error(String(err)));
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
    config.evaluationMode,
    config.deviceInfoProvider,
    config.cacheMaxAgeMs,
  ]);

  // In server mode, re-resolve when the identity changes so the cached
  // server response is refreshed for the new user.
  useEffect(() => {
    const currentClient = clientRef.current;
    if (!currentClient || !ready) return;

    const currentKey = getUnitKey();
    if (prevUnitKeyRef.current === null) {
      prevUnitKeyRef.current = currentKey;
      return;
    }
    if (prevUnitKeyRef.current === currentKey) return;
    prevUnitKeyRef.current = currentKey;

    currentClient.setStableId(currentKey);
    currentClient.refreshConfig().then(() => {
      setResolveVersion((v) => v + 1);
    }).catch(() => {});
  }, [ready, getUnitKey]);

  const contextValue = useMemo<TrafficalContextValue>(
    () => ({
      client,
      ready,
      error,
      getUnitKey,
      getContext,
      resolveVersion,
      overrideVersion,
      initialParams: config.initialParams,
      localConfig: config.localConfig,
    }),
    [
      client,
      ready,
      error,
      getUnitKey,
      getContext,
      resolveVersion,
      overrideVersion,
      config.initialParams,
      config.localConfig,
    ]
  );

  if (!ready && loadingComponent) {
    return (
      <TrafficalContext.Provider value={contextValue}>
        {loadingComponent}
      </TrafficalContext.Provider>
    );
  }

  return (
    <TrafficalContext.Provider value={contextValue}>
      {children}
    </TrafficalContext.Provider>
  );
}
