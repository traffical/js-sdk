---
"@traffical/node": patch
---

Emit `policyKey` and `allocationKey` on `assignmentLogger` entries.

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
