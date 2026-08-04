# @traffical/core-io

## 0.7.1

### Patch Changes

- Updated dependencies [e5808ae]
  - @traffical/core@0.12.0

## 0.7.0

### Minor Changes

- 020ef5d: Make the warehouse-native logger available to server-side SDKs, and emit the
  stable warehouse-join keys in its rows.

  Two related defects in the bring-your-own-warehouse path:

  **The factory was browser-only.** `createWarehouseNativeLogger` — with its
  built-in Jitsu, Segment, and RudderStack destinations — lived in
  `@traffical/js-client`. `@traffical/node` never exported it, so the server-side
  BYO-warehouse integration, which is the one that actually needs a server-held
  Jitsu write key, had no built-in destination and had to hand-roll the sink.

  The implementation now lives in `@traffical/core-io` (the I/O package — the
  Jitsu destination performs `fetch`, so it does not belong in the I/O-free
  `@traffical/core`). `@traffical/node` re-exports `core-io`, so it picks the
  factory up automatically. `@traffical/js-client` re-exports it from its existing
  paths, so `import { createWarehouseNativeLogger } from "@traffical/js-client"`
  and the `plugins` index are unchanged — as are the `@traffical/svelte` and
  `@traffical/react-native` re-exports.

  **The row mapping dropped `policy_key` and `allocation_key`.** The emitted
  snake_case row carried `policy_id` and `allocation_name` but neither stable key,
  even when the entry had them. Those keys are exactly what a warehouse assignment
  definition joins on — the `*_id` columns are opaque and match nothing — so rows
  produced by this factory joined to zero policies and metrics came back empty
  rather than erroring. The PHP SDK's `WarehouseNativeLogger` already carried a
  comment noting the JS plugin's omission; the JS row now matches the PHP and
  Python row shape.

  Both keys pass through as `undefined` when the entry does not carry them, rather
  than falling back to the ids — a wrong join key is worse than a missing one.

## 0.6.2

### Patch Changes

- Updated dependencies [ca58edf]
  - @traffical/core@0.11.1

## 0.6.1

### Patch Changes

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

- Updated dependencies [11f489e]
- Updated dependencies [2a7e3b5]
- Updated dependencies [3484466]
  - @traffical/core@0.11.0

## 0.6.0

### Minor Changes

- 24ffc0a: Switch deterministic assignment from FNV-1a to the SHA-256 v2 hash.

### Patch Changes

- Updated dependencies [24ffc0a]
  - @traffical/core@0.10.0

## 0.5.3

### Patch Changes

- Updated dependencies [0181040]
- Updated dependencies [0181040]
  - @traffical/core@0.9.0

## 0.5.2

### Patch Changes

- Updated dependencies [0a58b77]
- Updated dependencies [96eb276]
- Updated dependencies [87b30d6]
  - @traffical/core@0.8.0

## 0.5.1

### Patch Changes

- Updated dependencies [d71ae22]
  - @traffical/core@0.7.0

## 0.5.0

### Minor Changes

- f0f31bc: Add type-safe event tracking and dev-mode schema warnings
- aebc425: Add typed event tracking with schema-aware clients. All SDK clients now accept an optional `TrafficalEvents` type parameter for compile-time validation of event names and properties in `track()` calls. Event loggers and batchers surface schema validation warnings from the edge API via a new `onSchemaWarnings` callback, enabling dev-mode visibility into tracking plan violations.

### Patch Changes

- Updated dependencies [f0f31bc]
- Updated dependencies [aebc425]
  - @traffical/core@0.6.0

## 0.4.0

### Minor Changes

- 23925fe: Add warehouse-native assignment logging and sync support with AssignmentLogger callback, batched warehouse-native-logger plugin, and managed server-side sync

### Patch Changes

- Updated dependencies [23925fe]
  - @traffical/core@0.5.0

## 0.3.1

### Patch Changes

- Updated dependencies [7c95577]
  - @traffical/core@0.4.0

## 0.3.0

### Minor Changes

- e90a26c: Add server-evaluated mode with unified /v1/resolve endpoint, DecisionClient, and evaluationMode option.

### Patch Changes

- Updated dependencies [e90a26c]
  - @traffical/core@0.3.0
