---
"@traffical/core": patch
"@traffical/js-client": patch
---

Fix incomplete layer resolution when no parameters match a layer. The resolution engine now processes all layers for bucket/policy/allocation matching regardless of requested parameters, populating `decision.metadata.layers` exhaustively for attribution and assignment tracking. Layers without matching parameters are marked `attributionOnly: true`. Exposure tracking in js-client skips attribution-only layers to prevent exposure inflation.
