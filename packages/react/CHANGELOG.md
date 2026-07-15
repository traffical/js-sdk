# @traffical/react

## 0.6.2

### Patch Changes

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

- Updated dependencies [11f489e]
- Updated dependencies [2a7e3b5]
- Updated dependencies [3484466]
  - @traffical/core@0.11.0
  - @traffical/js-client@0.16.0

## 0.6.1

### Patch Changes

- Updated dependencies [a1760ff]
  - @traffical/js-client@0.15.0

## 0.6.0

### Minor Changes

- 24ffc0a: Switch deterministic assignment from FNV-1a to the SHA-256 v2 hash.

### Patch Changes

- Updated dependencies [24ffc0a]
- Updated dependencies [cc6f894]
  - @traffical/core@0.10.0
  - @traffical/js-client@0.14.0

## 0.5.0

### Minor Changes

- 0181040: Add BYO `eventLogger` for full exposure/track/decision events, expose warehouse-native options in Svelte/React/RN wrappers, and add `createWarehouseNativeLogger` with Jitsu destination support.
- 0181040: Add eventLogger for full exposure/track/decision events, expose BYO

### Patch Changes

- Updated dependencies [0181040]
- Updated dependencies [0181040]
  - @traffical/core@0.9.0
  - @traffical/js-client@0.13.0

## 0.4.2

### Patch Changes

- Updated dependencies [0a58b77]
- Updated dependencies [96eb276]
- Updated dependencies [87b30d6]
  - @traffical/js-client@0.12.0
  - @traffical/core@0.8.0

## 0.4.1

### Patch Changes

- Updated dependencies [d71ae22]
  - @traffical/core@0.7.0
  - @traffical/js-client@0.11.1

## 0.4.0

### Minor Changes

- f0f31bc: Add type-safe event tracking and dev-mode schema warnings
- aebc425: Add typed event tracking with schema-aware clients. All SDK clients now accept an optional `TrafficalEvents` type parameter for compile-time validation of event names and properties in `track()` calls. Event loggers and batchers surface schema validation warnings from the edge API via a new `onSchemaWarnings` callback, enabling dev-mode visibility into tracking plan violations.

### Patch Changes

- Updated dependencies [f0f31bc]
- Updated dependencies [aebc425]
  - @traffical/core@0.6.0
  - @traffical/js-client@0.11.0

## 0.3.7

### Patch Changes

- Updated dependencies [5e44fed]
  - @traffical/js-client@0.10.1

## 0.3.6

### Patch Changes

- 5ddb821: Add onOverridesChange() listener to TrafficalClient for reactive parameter overrides. Framework providers (React, Svelte, React Native) now automatically re-evaluate params/decisions when overrides change via DevTools debug plugin.
- Updated dependencies [5ddb821]
  - @traffical/js-client@0.10.0

## 0.3.5

### Patch Changes

- Updated dependencies [fcc170e]
  - @traffical/js-client@0.9.2

## 0.3.4

### Patch Changes

- Updated dependencies [2645cbc]
  - @traffical/js-client@0.9.1

## 0.3.3

### Patch Changes

- 9d1868d: Add identify() API for mid-session identity changes. client.identify(unitKey) updates the stable ID and notifies all framework providers (React, Svelte, React Native), causing automatic re-evaluation and UI updates. Useful for login/logout flows and Traffical DevTools. Debug plugin now uses identify() instead of setStableId().
- Updated dependencies [9d1868d]
  - @traffical/js-client@0.9.0

## 0.3.2

### Patch Changes

- Updated dependencies [dc1ca31]
  - @traffical/js-client@0.8.0

## 0.3.1

### Patch Changes

- Updated dependencies [6cf30cd]
  - @traffical/js-client@0.7.0

## 0.3.0

### Minor Changes

- 23925fe: Add warehouse-native assignment logging and sync support with AssignmentLogger callback, batched warehouse-native-logger plugin, and managed server-side sync

### Patch Changes

- Updated dependencies [23925fe]
  - @traffical/js-client@0.6.0
  - @traffical/core@0.5.0

## 0.2.14

### Patch Changes

- Updated dependencies [7c95577]
  - @traffical/core@0.4.0
  - @traffical/js-client@0.5.1

## 0.2.13

### Patch Changes

- Updated dependencies [e0a2791]
  - @traffical/js-client@0.5.0

## 0.2.12

### Patch Changes

- Updated dependencies [119eacb]
  - @traffical/js-client@0.4.0

## 0.2.11

### Patch Changes

- Updated dependencies [e90a26c]
  - @traffical/js-client@0.3.0
  - @traffical/core@0.3.0

## 0.2.10

### Patch Changes

- Updated dependencies [637e1d4]
  - @traffical/core@0.2.4
  - @traffical/js-client@0.2.7

## 0.2.9

### Patch Changes

- 8cea5c1: Remove broken "bun" export condition from package.json exports map. The condition pointed to ./src/index.ts which is not included in the published npm tarball (only dist/ is shipped), causing a hard "Cannot find module" error for any Bun user consuming these packages from npm.
- Updated dependencies [8cea5c1]
  - @traffical/core@0.2.3
  - @traffical/js-client@0.2.6

## 0.2.8

### Patch Changes

- 1d5befe: implement cumulative attribution map to prevent loss during decision cache eviction
- Updated dependencies [1d5befe]
  - @traffical/js-client@0.2.5

## 0.2.7

### Patch Changes

- 1d15188: improve useTraffical() hook regarding synchronous decision resolution on avoiding redundant calls to `decide()`

## 0.2.6

### Patch Changes

- 815f3ff: Updated the attribution logic in the TrafficalClient to deduplicate entries by layerId and policyId, implementing a last-write-wins approach. This change ensures that only the most recent allocation is credited for per-entity dynamic allocation policies, enhancing the accuracy of event tracking across different product contexts.
- Updated dependencies [815f3ff]
  - @traffical/js-client@0.2.4

## 0.2.5

### Patch Changes

- c71c3ad: feat(js-client): add attributionMode option for track events
- Updated dependencies [c71c3ad]
  - @traffical/js-client@0.2.3

## 0.2.4

### Patch Changes

- 9a9a852: feat(react): Add flushEvents() to useTraffical return value for immediate event dispatch

  Users can now flush pending events immediately after critical conversions
  (like purchases) before page navigation:

  ```tsx
  const { params, track, flushEvents } = useTraffical({ defaults: {...} });

  const handleCheckout = async () => {
    track('purchase', { value: total });
    await flushEvents(); // Ensure event is sent before navigation
    router.replace('/checkout/success');
  };
  ```

## 0.2.3

### Patch Changes

- feat(react): Add flushEvents() to useTraffical return value for immediate event dispatch

  Users can now flush pending events immediately after critical conversions
  (like purchases) before page navigation:

  ```tsx
  const { params, track, flushEvents } = useTraffical({ defaults: {...} });

  const handleCheckout = async () => {
    track('purchase', { value: total });
    await flushEvents(); // Ensure event is sent before navigation
    router.replace('/checkout/success');
  };
  ```

## 0.2.2

### Patch Changes

- 3e14c53: Testing, back to using changesets.
- Updated dependencies [3e14c53]
  - @traffical/core@0.2.2
  - @traffical/js-client@0.2.2

## 0.2.1

### Patch Changes

- f4d7b71: Fix broken workspace dependencies from 0.2.0 release. Now using custom publish workflow that properly resolves workspace:^ to actual versions during bun publish.
- Updated dependencies [f4d7b71]
  - @traffical/core@0.2.1
  - @traffical/js-client@0.2.1

## 0.2.0

### Minor Changes

- f4c9288: Harmonize all package versions to 0.2.0. This release includes:
  - Fixed package exports pointing to compiled JavaScript (not TypeScript source)
  - Workspace dependencies for better monorepo release coordination
  - Full SvelteKit SSR support via @traffical/svelte/server

### Patch Changes

- Updated dependencies [f4c9288]
  - @traffical/core@0.2.0
  - @traffical/js-client@0.2.0

## 0.1.4

### Patch Changes

- b1eee70: Fix package exports to point to compiled JavaScript files instead of TypeScript source files. This resolves Node.js runtime errors (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING) and Vite dependency optimization failures when using these packages.
- Updated dependencies [b1eee70]
  - @traffical/core@0.1.4

## 0.1.3

### Patch Changes

- 362cf8d: fix: use npm version ranges instead of workspace protocol for dependencies
- Updated dependencies [362cf8d]
  - @traffical/js-client@0.1.4

## 0.1.2

### Patch Changes

- 7ec6faf: fix: replace workspace:^ with actual version numbers for npm publishing
- 6dc6740: Test changeset bump again
- Updated dependencies [7ec6faf]
- Updated dependencies [6dc6740]
  - @traffical/js-client@0.1.3
  - @traffical/core@0.1.3

## 0.1.2

### Patch Changes

- ec74054: Test npm changeset bump again
- f525104: Testing npm publishing
- Updated dependencies [ec74054]
- Updated dependencies [f525104]
  - @traffical/core@0.1.3
  - @traffical/js-client@0.1.3
