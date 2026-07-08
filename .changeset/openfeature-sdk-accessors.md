---
"@traffical/core": minor
"@traffical/js-client": minor
"@traffical/node": minor
---

Add adapter-facing SDK primitives for wrapping the client behind an OpenFeature provider (and other adapters), plus Node/browser exposure parity:

- **`getUnitKeyField()`** — core `getUnitKeyField(bundle)`; method on the node and js-client clients. Returns the context field the bundle buckets on (`hashing.unitKey`), so an adapter can map an external targeting key onto the correct field instead of guessing (e.g. writing `targetingKey` when the project buckets on `userId`).
- **`getParameterLayerId(key)`** — core `getParameterLayerId(bundle, key)`; method on the node and js-client clients. Returns the layer a parameter belongs to, so an adapter resolving a single flag can select that flag's owning `LayerResolution`. (A single-key `decide()` returns a resolution for every matched layer — siblings flagged `attributionOnly` — so positional selection is unsafe.)
- **Node `trackExposure()` now matches the browser SDK**: it skips `attributionOnly` layers and deduplicates per `(unit, policy, allocation)` within a session (new `deduplicateExposures` / `exposureSessionTtlMs` options; default on / 30 min). Previously the Node SDK emitted a single exposure event carrying every matched layer with no session dedup, over-counting exposures for experiments a unit was only assigned to (for attribution) but not actually shown. **Behavior change for existing Node users:** server-side exposure events now reflect only the layers actually exposed.

All additions are backward-compatible at the API level.
