# @traffical/openfeature-web

## 0.2.4

### Patch Changes

- Updated dependencies [020ef5d]
  - @traffical/js-client@0.16.2

## 0.2.2

### Patch Changes

- 1062913: Fix `TrafficalWebProvider.track` arity — browser exposures and reward values were being dropped

  The provider declared `track(name, details)`, but the provider-side contract
  (`CommonProvider.track` in `@openfeature/core`) is `track(name, context, details)`:
  the application calls `client.track(name, details)` and the SDK injects the bound
  evaluation context before calling the provider. The provider was therefore reading
  the **context** as its details, so:

  - every `$traffical.exposure` lost its `flagKey`, missed the decision memo and was
    dropped — leaving treatment-on-the-treated metrics, the SRM health gate and bandit
    training silently empty for every browser integration;
  - every reward lost its numeric `value`, and carried the context's fields as
    properties instead of the caller's details.

  `track` now takes the context and derives the reward unit key from the targeting key
  the SDK hands it (falling back to the bound context, then the client's stable id).
  The class implements `Provider` only — the `Tracking` interface exported by the web
  SDK is the _client_-side one, and a provider claiming to implement it ends up with
  the wrong arity.

  TypeScript could not catch this: a function with fewer parameters is assignable to
  one with more. The regression guard is therefore a test that drives
  `OpenFeature.getClient().track(...)` through the provider and asserts the `flagKey`
  and reward `value` survive — the server provider already had such a test, which is
  why its arity was correct. Do not replace it with a direct `provider.track(...)` call.

  Callers who invoked `provider.track(...)` directly (rather than through the
  OpenFeature client) must add the context argument.

## 0.2.1

### Patch Changes

- Updated dependencies [ca58edf]
  - @traffical/core@0.11.1
  - @traffical/js-client@0.16.1
  - @traffical/openfeature-core@0.2.1

## 0.2.0

### Minor Changes

- 81bc692: Initial release of the Traffical OpenFeature provider suite: a server (dynamic-context) provider backed by `@traffical/node`, a web (static-context) provider backed by `@traffical/js-client`, and the shared `@traffical/openfeature-core` translation layer they both build on.

  The providers are thin translation membranes over an already-constructed native Traffical client (constructor injection — the caller owns client lifecycle):

  - **Resolve = decision (ITT).** Each `resolve*` call runs one native `decide()` — emitting the intent-to-treat decision event — and translates the resulting `DecisionResult` into an OpenFeature `ResolutionDetails`. The owning layer is selected by id (never positionally), so a single-key decide's attribution-only sibling layers can't attach the wrong variant/propensity. Values are strictly type-checked (no coercion); a mismatch throws `TypeMismatchError` and the OpenFeature SDK maps it to the default with `reason: ERROR`.
  - **Explicit `$traffical.exposure` (ToT).** Exposure (treatment-on-the-treated) is a separate, render-time signal fired via `track("$traffical.exposure", …, { flagKey })`. That reserved event name is routed to the native `trackExposure()` and stitched to the exact decision the caller already saw — the exposure path NEVER re-decides. All other `track()` names are business/reward events. The exposure event name is overridable to avoid collisions.
  - **`exposureOnResolve` escape hatch.** When set, the resolver fires the exposure on the just-made decision (collapsing ToT toward ITT) for teams that can't instrument explicit render-time exposures.
  - **No-exposure alarm.** Recording decisions but zero exposures leaves treatment-on-the-treated metrics, the SRM health gate, and bandit optimization silently empty; both providers fire a one-shot warning (and a non-fatal provider Error event) once decisions accumulate without any exposure.
  - **Scalar `flagMetadata` contract.** `traffical.*` keys are emitted as scalars only (`string | number | boolean`), never nested; undefined/null sources are omitted (key-absent). The web provider additionally gates `propensity` and `modelVersion` out so bandit selection internals never leak to browser devtools.
  - **`targetingKey` → unit-key mapping.** The OpenFeature `targetingKey` is written under the bundle's actual bucketing field (`hashing.unitKey`, via `getUnitKeyField()`), not a literal `"targetingKey"` field — otherwise the client's context enrichment would mis-bucket the unit. Overridable via the `unitKey` option; a missing targeting key throws `TargetingKeyMissingError`.

  The server provider adds a request-scoped decision store (`runInRequest`) so resolve, exposure, and reward share one store per request; the web provider binds a single static context and clears its decision memo on every context change.

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
- Updated dependencies [81bc692]
- Updated dependencies [2a7e3b5]
- Updated dependencies [3484466]
  - @traffical/core@0.11.0
  - @traffical/js-client@0.16.0
  - @traffical/openfeature-core@0.2.0
