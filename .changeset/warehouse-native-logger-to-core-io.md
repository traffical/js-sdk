---
"@traffical/core-io": minor
"@traffical/js-client": patch
"@traffical/node": minor
---

Make the warehouse-native logger available to server-side SDKs, and emit the
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
