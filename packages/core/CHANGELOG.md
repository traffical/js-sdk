# @traffical/core

## 0.11.0

### Minor Changes

- 11f489e: Align the JS SDKs to the spec 0.7.0 drift-remediation contract.

  **Contract behavior (`@traffical/core`)**

  - **S1 — empty/whitespace layer `unitKey` override skips the layer.** An empty
    or whitespace-only layer `unitKey` override is now treated as invalid: the
    layer resolves to `bucket -1` with its parameters at defaults and no
    exposure, and carries no `unitKey`/`unitKeyValue` metadata. The engine no
    longer falls back to the project unit key (the previous 1-of-4 outlier
    behavior).
  - **S7 — no `stateVersion` fallback for contextual `modelVersion`.** It is now
    `contextualModel.generatedAt ?? contextualModel.modelVersion`, and omitted
    entirely when both are absent, rather than falling back to
    `policy.stateVersion`.
  - Verified S2 (canonical numeric unit-key stringify), S3 (strict-typed
    conditions), S5 (omitted relational value never matches), and S6
    (`safeGamma`/`effectiveFloor` guards) against the 0.7.0 conformance vectors.
  - Added the canonical `TrackEventOptions` type.

  **Event delivery (S8) — `@traffical/node`, `@traffical/js-client`**

  - Bounded in-memory event queue with drop-oldest and a dropped-event counter
    (`eventMaxQueueSize`, default 1000); no more unbounded requeue-on-failure.
  - Node: per-batch exponential-backoff retry on transient failures; browser:
    transient failures persisted for retry.
  - HTTP 401 auth kill-switch permanently disables event delivery and clears the
    queue for the process/session lifetime.

  **Exposure shape (S4) — `@traffical/js-client`**

  - `trackExposure()` emits ONE event per call carrying only newly-exposed,
    non-`attributionOnly` layers (session dedup on by default), matching the Node
    SDK — replacing the previous one-event-per-layer shape that carried the full
    unfiltered layers array.

  **Server mode (S8) — `@traffical/node`, `@traffical/js-client`**

  - `decide()`/`getParams()` thread the per-call context into a throttled
    `/v1/resolve` and mint a fresh `decisionId` per `decide()` instead of reusing
    the resolve snapshot's `decisionId`.

  **Public API (A1, additive / non-breaking)**

  - `waitForReady()` and a single teardown verb `close()` (awaits the final
    flush; `destroy()`/`destroySync()` deprecated via JSDoc).
  - Positional `decide(context, defaults)` / `getParams(context, defaults)`
    overloads that still accept the legacy `({ context, defaults })` bag
    (soft-deprecated).
  - `track()` options bag extended with `value` / `values` / `eventTimestamp`;
    Node `trackReward()` now forwards `value` + `decisionId` (previously dropped).

  **Other**

  - URL-encode `env`/`projectId` in the config-fetch URL.
  - `@traffical/core-io`: no API change (patch bump for the pinned spec).

- 2a7e3b5: Add adapter-facing SDK primitives for wrapping the client behind an OpenFeature provider (and other adapters), plus Node/browser exposure parity:

  - **`getUnitKeyField()`** — core `getUnitKeyField(bundle)`; method on the node and js-client clients. Returns the context field the bundle buckets on (`hashing.unitKey`), so an adapter can map an external targeting key onto the correct field instead of guessing (e.g. writing `targetingKey` when the project buckets on `userId`).
  - **`getParameterLayerId(key)`** — core `getParameterLayerId(bundle, key)`; method on the node and js-client clients. Returns the layer a parameter belongs to, so an adapter resolving a single flag can select that flag's owning `LayerResolution`. (A single-key `decide()` returns a resolution for every matched layer — siblings flagged `attributionOnly` — so positional selection is unsafe.)
  - **Node `trackExposure()` now matches the browser SDK**: it skips `attributionOnly` layers and deduplicates per `(unit, policy, allocation)` within a session (new `deduplicateExposures` / `exposureSessionTtlMs` options; default on / 30 min). Previously the Node SDK emitted a single exposure event carrying every matched layer with no session dedup, over-counting exposures for experiments a unit was only assigned to (for attribution) but not actually shown. **Behavior change for existing Node users:** server-side exposure events now reflect only the layers actually exposed.

  All additions are backward-compatible at the API level.

- 3484466: Propensity logging for off-policy training. Layer resolution entries gain optional `probability` (the chosen allocation's selection probability at decision time: floored-softmax probability for linear_contextual policies, bucket-range share for other adaptive policies, the entity weight actually used for per-entity bundle-mode policies; omitted for static policies, edge-resolved selections, and any value outside (0, 1]) and `modelVersion` (linear_contextual only: the bundle model's `generatedAt`, falling back to its `modelVersion` alias, then the policy `stateVersion`). Decision and exposure events gain optional top-level `configVersion` — the config bundle version the SDK evaluated against, snapshotted into the decision metadata at decide() time (server mode: the resolve response's `stateVersion`) and stamped onto events from that snapshot. `AssignmentLogEntry` gains optional `bucket`, `probability`, `modelVersion`, and `configVersion`, and the warehouse-native logger maps them to the `bucket`, `propensity`, `model_version`, and `config_version` row keys (matching the PHP SDK). New `resolveContextualPolicyDetailed` export returns the chosen allocation with its probability; `resolveContextualPolicy` is unchanged. All fields are additive and optional.

## 0.10.0

### Minor Changes

- 24ffc0a: Switch deterministic assignment from FNV-1a to the SHA-256 v2 hash.

## 0.9.0

### Minor Changes

- 0181040: Add BYO `eventLogger` for full exposure/track/decision events, expose warehouse-native options in Svelte/React/RN wrappers, and add `createWarehouseNativeLogger` with Jitsu destination support.
- 0181040: Add eventLogger for full exposure/track/decision events, expose BYO

## 0.8.0

### Minor Changes

- 0a58b77: Add warehouse-native assignment fields to the BYO assignmentLogger.
- 87b30d6: feat(sdk): add type, decisionId, anonymousId, id to assignmentLogger entries

### Patch Changes

- 96eb276: Canonicalize FNV-1a hashing over UTF-8 bytes for deterministic bucketing

## 0.7.0

### Minor Changes

- d71ae22: Add per-layer unit key support for multi-entity randomization. `BundleLayer` now accepts an optional `unitKey` override, and `LayerResolution` exposes `unitKey` / `unitKeyValue` on exposure events. The resolution engine resolves the unit key per layer, falling back to the bundle-level default.

## 0.6.0

### Minor Changes

- f0f31bc: Add type-safe event tracking and dev-mode schema warnings
- aebc425: Add typed event tracking with schema-aware clients. All SDK clients now accept an optional `TrafficalEvents` type parameter for compile-time validation of event names and properties in `track()` calls. Event loggers and batchers surface schema validation warnings from the edge API via a new `onSchemaWarnings` callback, enabling dev-mode visibility into tracking plan violations.

## 0.5.0

### Minor Changes

- 23925fe: Add warehouse-native assignment logging and sync support with AssignmentLogger callback, batched warehouse-native-logger plugin, and managed server-side sync

## 0.4.0

### Minor Changes

- 7c95577: Add SDK-side contextual bandit scoring — reads policy.contextualModel from the bundle, computes per-allocation scores via linear dot-product, applies softmax with gamma temperature and probability floor, and deterministically selects an allocation

## 0.3.0

### Minor Changes

- e90a26c: Add server-evaluated mode with unified /v1/resolve endpoint, DecisionClient, and evaluationMode option.

## 0.2.4

### Patch Changes

- 637e1d4: Fix incomplete layer resolution when no parameters match a layer. The resolution engine now processes all layers for bucket/policy/allocation matching regardless of requested parameters, populating `decision.metadata.layers` exhaustively for attribution and assignment tracking. Layers without matching parameters are marked `attributionOnly: true`. Exposure tracking in js-client skips attribution-only layers to prevent exposure inflation.

## 0.2.3

### Patch Changes

- 8cea5c1: Remove broken "bun" export condition from package.json exports map. The condition pointed to ./src/index.ts which is not included in the published npm tarball (only dist/ is shipped), causing a hard "Cannot find module" error for any Bun user consuming these packages from npm.

## 0.2.2

### Patch Changes

- 3e14c53: Testing, back to using changesets.

## 0.2.1

### Patch Changes

- f4d7b71: Fix broken workspace dependencies from 0.2.0 release. Now using custom publish workflow that properly resolves workspace:^ to actual versions during bun publish.

## 0.2.0

### Minor Changes

- f4c9288: Harmonize all package versions to 0.2.0. This release includes:
  - Fixed package exports pointing to compiled JavaScript (not TypeScript source)
  - Workspace dependencies for better monorepo release coordination
  - Full SvelteKit SSR support via @traffical/svelte/server

## 0.1.4

### Patch Changes

- b1eee70: Fix package exports to point to compiled JavaScript files instead of TypeScript source files. This resolves Node.js runtime errors (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING) and Vite dependency optimization failures when using these packages.

## 0.1.3

### Patch Changes

- 6dc6740: Test changeset bump again

## 0.1.3

### Patch Changes

- ec74054: Test npm changeset bump again
- f525104: Testing npm publishing
