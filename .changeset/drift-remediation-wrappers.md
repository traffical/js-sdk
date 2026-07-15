---
"@traffical/svelte": minor
"@traffical/react-native": minor
"@traffical/react": patch
"@traffical/openfeature-server": patch
"@traffical/openfeature-web": patch
---

Phase 2 drift-remediation for the framework wrappers (spec 0.7.0).

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
