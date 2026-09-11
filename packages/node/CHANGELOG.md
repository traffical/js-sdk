# @traffical/node

## 0.12.1

### Patch Changes

- e92089d: Docs: use real Traffical key formats in examples, and the right key kind per example.

  Every example showed a Stripe-shaped placeholder — `apiKey: 'pk_...'`,
  `api_key="sk_..."`, `'your_sdk_key'` — none of which is a Traffical key. That was
  always wrong, and it became actively misleading now that `traffical_pk_` is a real
  key class: `pk_...` reads like a truncated genuine key rather than a placeholder.

  Examples now show `traffical_pk_…` or `traffical_sk_…`, chosen per example by where
  the code runs. Browser packages (`js-client`, `react`, `react-native`, `svelte`,
  `openfeature-web`) show the publishable key; `node` shows the server key.

  Two specifics worth calling out:

  - **Server-Evaluated Mode needs a server key.** `/v1/resolve` rejects publishable
    keys, so `evaluationMode: 'server'` only works from a backend. The root README now
    says so explicitly instead of leaving it to a 403.
  - **Browser env vars are now named for the key they hold** — `PUBLIC_TRAFFICAL_PUBLISHABLE_KEY`
    (SvelteKit) and `NEXT_PUBLIC_TRAFFICAL_PUBLISHABLE_KEY` (Next.js), each with a note
    that the value is compiled into the client bundle and must be a `traffical_pk_…`
    key. Nothing in the SDKs reads these names — you pass `apiKey` yourself — so this
    is a documentation change, not a breaking one.

  Documentation only. No runtime behaviour changed in any package.

## 0.12.0

### Minor Changes

- e5808ae: Tiered error posture: contain failures where they happen, and never let a
  failing side effect change a resolution result.

  Implements `docs/design/sdk-error-posture.md`. Three tiers, and the rule that
  binds them — **a lower tier must never change a higher tier's answer**:

  | Tier             | Covers                                                     | Posture                             | Configurable |
  | ---------------- | ---------------------------------------------------------- | ----------------------------------- | ------------ |
  | 1 · side effects | `assignmentLogger`, `eventLogger`, `onError`, plugin hooks | always contained + counted          | no           |
  | 2 · resolution   | `decide` / `getParams` / `trackExposure` / `track`         | caller defaults + `metadata.reason` | yes          |
  | 3 · ingestion    | fetched bundle **and** `localConfig`                       | reject whole, keep last-good        | no           |

  **Fixed — a failing sink discarded the decision (`@traffical/js-client`).**
  `decide()` wrapped resolution _and_ assignment logging in one boundary with a
  defaults fallback, so a throwing `assignmentLogger` returned control for a unit
  that had been bucketed into treatment — while `getParams()`, which emits no
  assignment rows, still returned treatment for the same unit. Because a bounded
  queue throws when full, that biased assignment with traffic load. Assignment
  rows are now emitted outside the boundary and each callback invocation is
  guarded individually.

  **Fixed — a throwing `assignmentLogger` propagated into the host
  (`@traffical/node`).** The full-event `eventLogger` was already guarded; the
  assignment logger was not. Both are now Tier 1: contained, counted, and never
  rethrown — including under `onResolutionError: "throw"`, matching Eppo,
  GrowthBook, Statsig, and OpenFeature, none of which let a customer's logging
  sink become an exception in their request path.

  **Fixed — only top-level bundle structure was validated, and `localConfig` was
  not validated at all.** `layers[].policies` being absent threw
  `TypeError: undefined is not an object` out of `decide()`. Validation is now
  deep (layers → policies → allocations → conditions, including bucket-range
  bounds) and runs at **both** ingestion points — previously the bundle arriving
  over TLS from our own edge was checked and the one a customer hand-assembles
  was not. A rejected bundle is dropped whole; the client keeps last-good.

  **New — `onResolutionError: "default" | "throw"`, default `"default"`.**
  Resolution failures return the caller's defaults and stamp
  `metadata.reason: "error"`. `"throw"` rethrows, for CI and staging. Tier 1
  ignores it entirely.

  **New — `onError(tag, error)`** (deduplicated per `tag:name:message`) and
  **`client.getDiagnostics()`** returning contained-error counters
  (`resolutionErrors`, `droppedAssignmentLogs`, `droppedEventLogs`,
  `rejectedBundles`, `sideEffectErrors`, `lastError`). Degradation is now visible
  without catching anything — the js-client bug above stayed invisible precisely
  because nothing reported it.

  **New — `metadata.reason`** on every decision: `"resolved" | "default" |
"no-bundle" | "error"`, mirroring OpenFeature's `reason`.

  **Removed — `strictMode`.** It was declared and stored but never read. The name
  is now free; `onResolutionError` covers the behaviour it implied.

  **Deprecated — `@traffical/js-client`'s `ErrorBoundary`** and the
  `errorBoundary` client option, superseded by the shared `ErrorPolicy` in
  `@traffical/core`. `errorBoundary.onError` is still honored.

  Also adds a conformance test asserting the deep validator accepts every
  published `sdk-spec` bundle fixture. A validator that is too strict takes the
  SDK offline, which is worse than the crash it prevents — the test caught
  exactly that in the first draft, which required `conditions[].operator` where
  the spec says `op`.

### Patch Changes

- Updated dependencies [e5808ae]
  - @traffical/core@0.12.0
  - @traffical/core-io@0.7.1

## 0.11.0

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

### Patch Changes

- e150217: Emit `policyKey` and `allocationKey` on `assignmentLogger` entries.

  The Node SDK was the only SDK that dropped the two stable keys when building an
  `AssignmentLogEntry`: the core resolver populates `policyKey`/`allocationKey` on
  every layer resolution, and `@traffical/js-client`, PHP, Python, and iOS all
  forward them, but Node emitted only `policyId` and `allocationName`.

  This matters for bring-your-own-warehouse pipelines. A warehouse assignment
  definition's `policy_key` column is matched against the policy's **key**, not
  its id, so a Node integration writing `policyId` into that column produced rows
  that joined to nothing — every metric silently returned zero instead of
  erroring. `allocationKey` was affected the same way.

  Nothing else changes: exposure, decision, and track events already carried the
  keys (they pass `decision.metadata.layers` through unmodified), and the
  assignment-logger deduplication key is unchanged.

  The gap survived because the assignment-logger contract has no shared
  conformance fixture and the Node test fixture omitted both fields. The tests now
  use policy/allocation keys that differ from their ids and names, and cover
  bundle mode as well as server mode.

- Updated dependencies [020ef5d]
  - @traffical/core-io@0.7.0

## 0.10.1

### Patch Changes

- Updated dependencies [ca58edf]
  - @traffical/core@0.11.1
  - @traffical/core-io@0.6.2

## 0.10.0

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

## 0.9.0

### Minor Changes

- a1760ff: New requestTimeoutMs option (default 10s, matching the repo's \*Ms idiom; core-io's AbortController pattern) on the browser config fetch + event POST, and — discovered during the work — the node package's config fetch and event batcher had the identical bug, fixed the same way. Aborts flow down the existing offline-warning / persist-for-retry paths; timers cleared in finally. The unload keepalive beacon path was deliberately left timeout-free (documented).

## 0.8.0

### Minor Changes

- 24ffc0a: Switch deterministic assignment from FNV-1a to the SHA-256 v2 hash.

### Patch Changes

- Updated dependencies [24ffc0a]
  - @traffical/core@0.10.0
  - @traffical/core-io@0.6.0

## 0.7.0

### Minor Changes

- 0181040: Add BYO `eventLogger` for full exposure/track/decision events, expose warehouse-native options in Svelte/React/RN wrappers, and add `createWarehouseNativeLogger` with Jitsu destination support.
- 0181040: Add eventLogger for full exposure/track/decision events, expose BYO

### Patch Changes

- Updated dependencies [0181040]
- Updated dependencies [0181040]
  - @traffical/core@0.9.0
  - @traffical/core-io@0.5.3

## 0.6.0

### Minor Changes

- 0a58b77: Add warehouse-native assignment fields to the BYO assignmentLogger.
- 87b30d6: feat(sdk): add type, decisionId, anonymousId, id to assignmentLogger entries

### Patch Changes

- Updated dependencies [0a58b77]
- Updated dependencies [96eb276]
- Updated dependencies [87b30d6]
  - @traffical/core@0.8.0
  - @traffical/core-io@0.5.2

## 0.5.1

### Patch Changes

- Updated dependencies [d71ae22]
  - @traffical/core@0.7.0
  - @traffical/core-io@0.5.1

## 0.5.0

### Minor Changes

- f0f31bc: Add type-safe event tracking and dev-mode schema warnings
- aebc425: Add typed event tracking with schema-aware clients. All SDK clients now accept an optional `TrafficalEvents` type parameter for compile-time validation of event names and properties in `track()` calls. Event loggers and batchers surface schema validation warnings from the edge API via a new `onSchemaWarnings` callback, enabling dev-mode visibility into tracking plan violations.

### Patch Changes

- Updated dependencies [f0f31bc]
- Updated dependencies [aebc425]
  - @traffical/core@0.6.0
  - @traffical/core-io@0.5.0

## 0.4.1

### Patch Changes

- dc1ca31: Add global instance discovery (window.**TRAFFICAL_INSTANCES**) and late plugin initialization support. client.use() now fires onInitialize/onConfigUpdate immediately for already-initialized clients, enabling DevTools to attach debug plugins to running SDK instances. Auto-generate SDK_VERSION from package.json.

## 0.4.0

### Minor Changes

- 23925fe: Add warehouse-native assignment logging and sync support with AssignmentLogger callback, batched warehouse-native-logger plugin, and managed server-side sync

### Patch Changes

- Updated dependencies [23925fe]
  - @traffical/core-io@0.4.0
  - @traffical/core@0.5.0

## 0.3.1

### Patch Changes

- Updated dependencies [7c95577]
  - @traffical/core@0.4.0
  - @traffical/core-io@0.3.1

## 0.3.0

### Minor Changes

- e90a26c: Add server-evaluated mode with unified /v1/resolve endpoint, DecisionClient, and evaluationMode option.

### Patch Changes

- Updated dependencies [e90a26c]
  - @traffical/core@0.3.0
  - @traffical/core-io@0.3.0

## 0.2.4

### Patch Changes

- Updated dependencies [637e1d4]
  - @traffical/core@0.2.4

## 0.2.3

### Patch Changes

- 8cea5c1: Remove broken "bun" export condition from package.json exports map. The condition pointed to ./src/index.ts which is not included in the published npm tarball (only dist/ is shipped), causing a hard "Cannot find module" error for any Bun user consuming these packages from npm.
- Updated dependencies [8cea5c1]
  - @traffical/core@0.2.3

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

- b1eee70: Fix package exports to point to compiled JavaScript files instead of TypeScript source files. This resolves Node.js runtime errors (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING) and Vite dependency optimization failures when using these packages.
- Updated dependencies [b1eee70]
  - @traffical/core@0.1.4

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
