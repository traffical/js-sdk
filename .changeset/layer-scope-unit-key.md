---
"@traffical/core": minor
---

Add per-layer unit key support for multi-entity randomization. `BundleLayer` now accepts an optional `unitKey` override, and `LayerResolution` exposes `unitKey` / `unitKeyValue` on exposure events. The resolution engine resolves the unit key per layer, falling back to the bundle-level default.
