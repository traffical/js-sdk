# @traffical/react-native

## 0.8.0

### Minor Changes

- b113523: Phase 2 drift-remediation for the framework wrappers (spec 0.7.0).

  **@traffical/svelte**

  - **CSR bundle propagation fix.** A provider mounted without an `initialBundle`
    no longer strands resolved params at their defaults. The provider keeps its
    tracked bundle in sync with the client via the client's `onConfigUpdate` hook
    and exposes `onConfigChange()`/`configVersion`, so hooks recompute once the
    first client-side fetch (and every background refresh) lands. `config.localConfig`
    is honored as the seed bundle.
  - `useTraffical` subscriptions (override/identity/config) are wrapped in a
    `$effect` with cleanup — previously they leaked one listener set per mounted
    component.
  - `getContext()` projects identity onto the bundle's real `hashing.unitKey` via
    `client.getUnitKeyField()` so a custom unit key buckets correctly.
  - SSR clients are created with `eventFlushIntervalMs: 0` + `trackDecisions: false`
    so per-request server clients don't leak timers or emit throwaway decision
    events.
  - Test files are excluded from the published `dist`.

  **@traffical/react-native**

  - **Offline server-response cache** now works: the full resolve response is
    persisted and injected into client state before initialization, so an offline
    cold start serves the last-known assignments (previously only a timestamp was
    stored).
  - The native `AppState` subscription is torn down on `destroy()`/`close()` (no
    more leaked listener). Adds the canonical `close()` teardown verb.
  - `getContext()` maps identity onto the bundle's real `hashing.unitKey`.
  - Recursive sorted-key stable dependency keys (nested context/defaults changes
    are now detected); init-effect deps stabilized to stop destroy+refetch storms.

  **@traffical/react**

  - Recursive sorted-key stable dependency keys; `getContext()` maps identity onto
    the bundle's real `hashing.unitKey`; init-effect deps stabilized to primitives
    to stop destroy+refetch storms (memoize `config`).

  **@traffical/openfeature-server / @traffical/openfeature-web**

  - Conformance tests load canonical vectors through a portable multi-root loader
    instead of a brittle hard-coded sibling path.
  - openfeature-server: `close()` added to the structural client interface and
    preferred in teardown (the 0.7.0 single teardown verb).

### Patch Changes

- Updated dependencies [11f489e]
- Updated dependencies [2a7e3b5]
- Updated dependencies [3484466]
  - @traffical/core@0.11.0
  - @traffical/js-client@0.16.0

## 0.7.1

### Patch Changes

- Updated dependencies [a1760ff]
  - @traffical/js-client@0.15.0

## 0.7.0

### Minor Changes

- 24ffc0a: Switch deterministic assignment from FNV-1a to the SHA-256 v2 hash.

### Patch Changes

- Updated dependencies [24ffc0a]
- Updated dependencies [cc6f894]
  - @traffical/core@0.10.0
  - @traffical/js-client@0.14.0

## 0.6.0

### Minor Changes

- 0181040: Add BYO `eventLogger` for full exposure/track/decision events, expose warehouse-native options in Svelte/React/RN wrappers, and add `createWarehouseNativeLogger` with Jitsu destination support.
- 0181040: Add eventLogger for full exposure/track/decision events, expose BYO

### Patch Changes

- Updated dependencies [0181040]
- Updated dependencies [0181040]
  - @traffical/core@0.9.0
  - @traffical/js-client@0.13.0

## 0.5.2

### Patch Changes

- Updated dependencies [0a58b77]
- Updated dependencies [96eb276]
- Updated dependencies [87b30d6]
  - @traffical/js-client@0.12.0
  - @traffical/core@0.8.0

## 0.5.1

### Patch Changes

- Updated dependencies [d71ae22]
  - @traffical/core@0.7.0
  - @traffical/js-client@0.11.1

## 0.5.0

### Minor Changes

- f0f31bc: Add type-safe event tracking and dev-mode schema warnings
- aebc425: Add typed event tracking with schema-aware clients. All SDK clients now accept an optional `TrafficalEvents` type parameter for compile-time validation of event names and properties in `track()` calls. Event loggers and batchers surface schema validation warnings from the edge API via a new `onSchemaWarnings` callback, enabling dev-mode visibility into tracking plan violations.

### Patch Changes

- Updated dependencies [f0f31bc]
- Updated dependencies [aebc425]
  - @traffical/core@0.6.0
  - @traffical/js-client@0.11.0

## 0.4.7

### Patch Changes

- Updated dependencies [5e44fed]
  - @traffical/js-client@0.10.1

## 0.4.6

### Patch Changes

- 5ddb821: Add onOverridesChange() listener to TrafficalClient for reactive parameter overrides. Framework providers (React, Svelte, React Native) now automatically re-evaluate params/decisions when overrides change via DevTools debug plugin.
- Updated dependencies [5ddb821]
  - @traffical/js-client@0.10.0

## 0.4.5

### Patch Changes

- Updated dependencies [fcc170e]
  - @traffical/js-client@0.9.2

## 0.4.4

### Patch Changes

- Updated dependencies [2645cbc]
  - @traffical/js-client@0.9.1

## 0.4.3

### Patch Changes

- 9d1868d: Add identify() API for mid-session identity changes. client.identify(unitKey) updates the stable ID and notifies all framework providers (React, Svelte, React Native), causing automatic re-evaluation and UI updates. Useful for login/logout flows and Traffical DevTools. Debug plugin now uses identify() instead of setStableId().
- Updated dependencies [9d1868d]
  - @traffical/js-client@0.9.0

## 0.4.2

### Patch Changes

- Updated dependencies [dc1ca31]
  - @traffical/js-client@0.8.0

## 0.4.1

### Patch Changes

- Updated dependencies [6cf30cd]
  - @traffical/js-client@0.7.0

## 0.4.0

### Minor Changes

- 23925fe: Add warehouse-native assignment logging and sync support with AssignmentLogger callback, batched warehouse-native-logger plugin, and managed server-side sync

### Patch Changes

- Updated dependencies [23925fe]
  - @traffical/js-client@0.6.0
  - @traffical/core@0.5.0

## 0.3.2

### Patch Changes

- Updated dependencies [7c95577]
  - @traffical/core@0.4.0
  - @traffical/js-client@0.5.1

## 0.3.1

### Patch Changes

- Updated dependencies [e0a2791]
  - @traffical/js-client@0.5.0

## 0.3.0

### Minor Changes

- 7175509: Add server-mode re-resolve on identity change via resolveVersion

## 0.2.0

### Minor Changes

- 119eacb: Add @traffical/react-native SDK with server-evaluated resolution, AsyncStorage caching, and AppState lifecycle. Export LifecycleProvider abstraction from js-client.

### Patch Changes

- Updated dependencies [119eacb]
  - @traffical/js-client@0.4.0
