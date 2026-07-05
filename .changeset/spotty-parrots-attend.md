---
"@traffical/core": minor
"@traffical/js-client": minor
"@traffical/node": minor
---

Propensity logging for off-policy training. Layer resolution entries gain optional `probability` (the chosen allocation's selection probability at decision time: floored-softmax probability for linear_contextual policies, bucket-range share for other adaptive policies, the entity weight actually used for per-entity bundle-mode policies; omitted for static policies, edge-resolved selections, and any value outside (0, 1]) and `modelVersion` (linear_contextual only: the bundle model's `generatedAt`, falling back to its `modelVersion` alias, then the policy `stateVersion`). Decision and exposure events gain optional top-level `configVersion` — the config bundle version the SDK evaluated against, snapshotted into the decision metadata at decide() time (server mode: the resolve response's `stateVersion`) and stamped onto events from that snapshot. `AssignmentLogEntry` gains optional `bucket`, `probability`, `modelVersion`, and `configVersion`, and the warehouse-native logger maps them to the `bucket`, `propensity`, `model_version`, and `config_version` row keys (matching the PHP SDK). New `resolveContextualPolicyDetailed` export returns the chosen allocation with its probability; `resolveContextualPolicy` is unchanged. All fields are additive and optional.
