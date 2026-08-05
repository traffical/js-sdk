---
"@traffical/react-native": patch
---

Docs: publishable keys require `evaluationMode: 'bundle'` in React Native.

This package defaults to `evaluationMode: 'server'`, which resolves through
`/v1/resolve`. That endpoint rejects publishable (`traffical_pk_…`) keys, so a
React Native app following the quick-start with a `pk` got a `403` on every
resolution with nothing explaining why.

The quick-start now sets `evaluationMode: 'bundle'` explicitly, and both the
config table and a callout state the constraint. Bundle mode fetches the config
bundle once and resolves on-device — no per-decision network call, works offline,
and it is the recommended mode for mobile regardless of key type.

Server-evaluated mode still requires a server-side SDK key (`traffical_sk_…`),
which must not ship in a mobile binary — in practice that means proxying
resolution through your own backend.

Documentation only. No runtime behaviour or defaults changed.
