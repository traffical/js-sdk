---
"@traffical/core": minor
"@traffical/node": minor
"@traffical/js-client": minor
---

Tiered error posture: contain failures where they happen, and never let a
failing side effect change a resolution result.

Implements `docs/design/sdk-error-posture.md`. Three tiers, and the rule that
binds them — **a lower tier must never change a higher tier's answer**:

| Tier | Covers | Posture | Configurable |
|---|---|---|---|
| 1 · side effects | `assignmentLogger`, `eventLogger`, `onError`, plugin hooks | always contained + counted | no |
| 2 · resolution | `decide` / `getParams` / `trackExposure` / `track` | caller defaults + `metadata.reason` | yes |
| 3 · ingestion | fetched bundle **and** `localConfig` | reject whole, keep last-good | no |

**Fixed — a failing sink discarded the decision (`@traffical/js-client`).**
`decide()` wrapped resolution *and* assignment logging in one boundary with a
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
