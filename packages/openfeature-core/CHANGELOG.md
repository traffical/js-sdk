# @traffical/openfeature-core

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

- Updated dependencies [11f489e]
- Updated dependencies [2a7e3b5]
- Updated dependencies [3484466]
  - @traffical/core@0.11.0
