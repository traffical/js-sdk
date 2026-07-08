# @traffical/openfeature-core

**Internal** package. Pure, paradigm-agnostic translation layer between Traffical's decision model and OpenFeature's evaluation model.

You almost certainly want a provider package instead:

- [`@traffical/openfeature-server`](../openfeature-server) — server (dynamic-context) provider, backed by `@traffical/node`.
- [`@traffical/openfeature-web`](../openfeature-web) — web (static-context) provider, backed by `@traffical/js-client`.

Both providers depend on this package and re-export the shared contract types (`TrafficalProviderOptions`, `TrafficalClientLike`, `OFFlagType`) and constants (`EXPOSURE_EVENT_NAME`, `FLAG_METADATA_PREFIX`) — so integrators normally never import `@traffical/openfeature-core` directly.

## What it does

The providers are thin translation membranes; the actual mapping logic lives here so it can be shared and unit-tested in isolation. Its public API is a contract that both providers build on:

- **`buildTrafficalContext(...)`** — maps an OpenFeature evaluation context (targeting key + attributes) onto a Traffical `Context`, writing the targeting value under the bundle's real unit-key field. Throws `TargetingKeyMissingError` when the targeting key is absent.
- **`toResolutionDetails(...)`** — translates a Traffical `DecisionResult` into an OpenFeature `ResolutionDetails` for a single flag: selects the owning layer (never positionally), reads the assignment (falling back to the default), strictly type-checks the value (throwing `TypeMismatchError` on mismatch — no coercion), and derives the `variant`, `reason`, and scalar `flagMetadata`.
- **`selectOwnerLayer` / `deriveReason` / `buildFlagMetadata`** — the composable pieces of that translation.
- **`EXPOSURE_EVENT_NAME`** (`$traffical.exposure`) and **`FLAG_METADATA_PREFIX`** (`traffical`) — the reserved names both providers key off of.

`flagMetadata` values are scalar-only (`string | number | boolean`); undefined/null sources are omitted entirely (key-absent, never an undefined value).
