---
"@traffical/core": minor
"@traffical/core-io": patch
"@traffical/js-client": minor
"@traffical/node": minor
---

Align the JS SDKs to the spec 0.7.0 drift-remediation contract.

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
