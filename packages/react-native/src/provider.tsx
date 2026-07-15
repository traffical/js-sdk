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

    // Project identity onto the bundle's REAL unit-key field so a custom
    // `hashing.unitKey` buckets correctly (mirrors openfeature-core). In server
    // mode the bundle isn't held locally, so getUnitKeyField() may be null —
    // fall back to the common field names.
    const unitKeyField = clientRef.current?.getUnitKeyField?.() ?? null;
    const identity = unitKeyField
      ? { [unitKeyField]: unitKey }
      : { userId: unitKey, deviceId: unitKey, anonymousId: unitKey };

    return {
      ...additionalContext,
      ...(deviceInfo ?? {}),
      ...identity,
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
          assignmentLogger: config.assignmentLogger,
          eventLogger: config.eventLogger,
          disableCloudEvents: config.disableCloudEvents,
          deduplicateAssignmentLogger: config.deduplicateAssignmentLogger,
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
    // Recreate the client only when the connection identity changes. Depend
    // ONLY on primitive/scalar options; non-primitive options — `plugins`,
    // `localConfig`, `assignmentLogger`/`eventLogger`, `deviceInfoProvider` —
    // are usually fresh references each render for inline `config` and would
    // otherwise cause a destroy+refetch storm. They are read once at
    // construction. Memoize `config` (or remount with a new `key`) to change
    // them at runtime. See the provider docs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    config.orgId,
    config.projectId,
    config.env,
    config.apiKey,
    config.baseUrl,
    config.refreshIntervalMs,
    config.trackDecisions,
    config.decisionDeduplicationTtlMs,
    config.exposureSessionTtlMs,
    config.eventBatchSize,
    config.eventFlushIntervalMs,
    config.disableCloudEvents,
    config.deduplicateAssignmentLogger,
    config.evaluationMode,
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
