# @traffical/js-client

## 0.16.0

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

### Patch Changes

- Updated dependencies [11f489e]
- Updated dependencies [2a7e3b5]
- Updated dependencies [3484466]
  - @traffical/core@0.11.0
  - @traffical/core-io@0.6.1

## 0.15.0

### Minor Changes

- a1760ff: New requestTimeoutMs option (default 10s, matching the repo's \*Ms idiom; core-io's AbortController pattern) on the browser config fetch + event POST, and — discovered during the work — the node package's config fetch and event batcher had the identical bug, fixed the same way. Aborts flow down the existing offline-warning / persist-for-retry paths; timers cleared in finally. The unload keepalive beacon path was deliberately left timeout-free (documented).

## 0.14.0

### Minor Changes

- 24ffc0a: Switch deterministic assignment from FNV-1a to the SHA-256 v2 hash.

### Patch Changes

- cc6f894: Change defaultEventName to traffical_exposure, traffical_decision.
- Updated dependencies [24ffc0a]
  - @traffical/core@0.10.0
  - @traffical/core-io@0.6.0

## 0.13.0

### Minor Changes

- 0181040: Add BYO `eventLogger` for full exposure/track/decision events, expose warehouse-native options in Svelte/React/RN wrappers, and add `createWarehouseNativeLogger` with Jitsu destination support.
- 0181040: Add eventLogger for full exposure/track/decision events, expose BYO

### Patch Changes

- Updated dependencies [0181040]
- Updated dependencies [0181040]
  - @traffical/core@0.9.0
  - @traffical/core-io@0.5.3

## 0.12.0

### Minor Changes

- 0a58b77: Add warehouse-native assignment fields to the BYO assignmentLogger.
- 87b30d6: feat(sdk): add type, decisionId, anonymousId, id to assignmentLogger entries

### Patch Changes

- Updated dependencies [0a58b77]
- Updated dependencies [96eb276]
- Updated dependencies [87b30d6]
  - @traffical/core@0.8.0
  - @traffical/core-io@0.5.2

## 0.11.1

### Patch Changes

- Updated dependencies [d71ae22]
  - @traffical/core@0.7.0
  - @traffical/core-io@0.5.1

## 0.11.0

### Minor Changes

- f0f31bc: Add type-safe event tracking and dev-mode schema warnings
- aebc425: Add typed event tracking with schema-aware clients. All SDK clients now accept an optional `TrafficalEvents` type parameter for compile-time validation of event names and properties in `track()` calls. Event loggers and batchers surface schema validation warnings from the edge API via a new `onSchemaWarnings` callback, enabling dev-mode visibility into tracking plan violations.

### Patch Changes

- Updated dependencies [f0f31bc]
- Updated dependencies [aebc425]
  - @traffical/core@0.6.0
  - @traffical/core-io@0.5.0

## 0.10.1

### Patch Changes

- 5e44fed: Make params a deep $state proxy so destructuring is safe. const { params } = useTraffical(...) now stays reactive. Fix useTrafficalPlugin to remove $derived.by warning.

## 0.10.0

### Minor Changes

- 5ddb821: Add onOverridesChange() listener to TrafficalClient for reactive parameter overrides. Framework providers (React, Svelte, React Native) now automatically re-evaluate params/decisions when overrides change via DevTools debug plugin.

## 0.9.2

### Patch Changes

- fcc170e: Add parameter override API for debug tooling. Client maintains an internal override map applied post-resolution in decide() and getParams(). Exposed via PluginClientAPI (applyOverrides, clearOverrides, getOverrides) for plugin-only access — not a public user-facing API. Debug plugin delegates override operations to the client instead of mutating hook arguments.

## 0.9.1

### Patch Changes

- 2645cbc: Add effectiveUnitKey to debug plugin state, capturing the actual unit key used for hashing from decision metadata

## 0.9.0

### Minor Changes

- 9d1868d: Add identify() API for mid-session identity changes. client.identify(unitKey) updates the stable ID and notifies all framework providers (React, Svelte, React Native), causing automatic re-evaluation and UI updates. Useful for login/logout flows and Traffical DevTools. Debug plugin now uses identify() instead of setStableId().

## 0.8.0

### Minor Changes

- dc1ca31: Add global instance discovery (window.**TRAFFICAL_INSTANCES**) and late plugin initialization support. client.use() now fires onInitialize/onConfigUpdate immediately for already-initialized clients, enabling DevTools to attach debug plugins to running SDK instances. Auto-generate SDK_VERSION from package.json.

## 0.7.0

### Minor Changes

- 6cf30cd: Add createDebugPlugin() for exposing SDK state to Traffical DevTools via window.**TRAFFICAL_DEBUG** global registry. Supports multi-instance debugging, event streaming, and external control (unit key, re-decide, refresh).

## 0.6.0

### Minor Changes

- 23925fe: Add warehouse-native assignment logging and sync support with AssignmentLogger callback, batched warehouse-native-logger plugin, and managed server-side sync

### Patch Changes

- Updated dependencies [23925fe]
  - @traffical/core-io@0.4.0
  - @traffical/core@0.5.0

## 0.5.1

### Patch Changes

- Updated dependencies [7c95577]
  - @traffical/core@0.4.0
  - @traffical/core-io@0.3.1

## 0.5.0

### Minor Changes

- e0a2791: new feature: add redirect experiment plugins

## 0.4.0

### Minor Changes

- 119eacb: Add @traffical/react-native SDK with server-evaluated resolution, AsyncStorage caching, and AppState lifecycle. Export LifecycleProvider abstraction from js-client.

## 0.3.0

### Minor Changes

- e90a26c: Add server-evaluated mode with unified /v1/resolve endpoint, DecisionClient, and evaluationMode option.

### Patch Changes

- Updated dependencies [e90a26c]
  - @traffical/core@0.3.0
  - @traffical/core-io@0.3.0

## 0.2.7

### Patch Changes

- 637e1d4: Fix incomplete layer resolution when no parameters match a layer. The resolution engine now processes all layers for bucket/policy/allocation matching regardless of requested parameters, populating `decision.metadata.layers` exhaustively for attribution and assignment tracking. Layers without matching parameters are marked `attributionOnly: true`. Exposure tracking in js-client skips attribution-only layers to prevent exposure inflation.
- Updated dependencies [637e1d4]
  - @traffical/core@0.2.4

## 0.2.6

### Patch Changes

- Updated dependencies [8cea5c1]
  - @traffical/core@0.2.3

## 0.2.5

### Patch Changes

- 1d5befe: implement cumulative attribution map to prevent loss during decision cache eviction

## 0.2.4

### Patch Changes

- 815f3ff: Updated the attribution logic in the TrafficalClient to deduplicate entries by layerId and policyId, implementing a last-write-wins approach. This change ensures that only the most recent allocation is credited for per-entity dynamic allocation policies, enhancing the accuracy of event tracking across different product contexts.

## 0.2.3

### Patch Changes

- c71c3ad: feat(js-client): add attributionMode option for track events

## 0.2.2

### Patch Changes

- 3e14c53: Testing, back to using changesets.
- Updated dependencies [3e14c53]
  - @traffical/core@0.2.2

## 0.2.1

### Patch Changes

- f4d7b71: Fix broken workspace dependencies from 0.2.0 release. Now using custom publish workflow that properly resolves workspace:^ to actual versions during bun publish.
- Updated dependencies [f4d7b71]
  - @traffical/core@0.2.1

## 0.2.0

### Minor Changes

- f4c9288: Harmonize all package versions to 0.2.0. This release includes:
  - Fixed package exports pointing to compiled JavaScript (not TypeScript source)
  - Workspace dependencies for better monorepo release coordination
  - Full SvelteKit SSR support via @traffical/svelte/server

### Patch Changes

- Updated dependencies [f4c9288]
  - @traffical/core@0.2.0

## 0.1.5

### Patch Changes

- 00bcac0: Update @traffical/core dependency to ^0.1.4 which has fixed JavaScript exports.

## 0.1.4

### Patch Changes

- 362cf8d: fix: use npm version ranges instead of workspace protocol for dependencies

## 0.1.3

### Patch Changes

- 7ec6faf: fix: replace workspace:^ with actual version numbers for npm publishing
- 6dc6740: Test changeset bump again
- Updated dependencies [6dc6740]
  - @traffical/core@0.1.3

## 0.1.3

### Patch Changes

- ec74054: Test npm changeset bump again
- f525104: Testing npm publishing
- Updated dependencies [ec74054]
- Updated dependencies [f525104]
  - @traffical/core@0.1.3
