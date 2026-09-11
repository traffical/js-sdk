---
"@traffical/js-client": minor
---

Debug plugin: context overrides, faithful re-decide, OpenFeature-aware re-render.

Two DevTools controls were inert:

- **Re-decide** called `decide({ context: {}, defaults: {} })`, which resolved
  no parameters and ignored whatever context the app had passed. It now replays
  the app's last real decision (same context, same parameter set), so the
  inspector shows what the app would resolve right now.
- **Context Properties** had no SDK hook at all. The debug instance gains
  `setContextOverrides(ctx)` / `getContextOverrides()`; overrides are merged
  into every decision's context via `onBeforeDecision`, so a targeting condition
  the app never sets (e.g. `testMode exists` on a QA policy) can be satisfied
  from DevTools. `DebugState` exposes `contextOverrides` and `lastContext`.

Apps that resolve through `@traffical/openfeature-web` never call `decide`
themselves — the provider does, off its bound OpenFeature context — so a plain
re-decide could not reach their UI. When the OpenFeature singleton is present,
re-decide now re-sets its context, which makes the provider clear its memo,
re-resolve through this client (picking up the overrides), and emit
`PROVIDER_CONTEXT_CHANGED`, the event OpenFeature hooks re-render on.
