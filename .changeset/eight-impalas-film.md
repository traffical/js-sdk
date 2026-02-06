---
"@traffical/js-client": patch
"@traffical/react": patch
"@traffical/svelte": patch
---

Updated the attribution logic in the TrafficalClient to deduplicate entries by layerId and policyId, implementing a last-write-wins approach. This change ensures that only the most recent allocation is credited for per-entity dynamic allocation policies, enhancing the accuracy of event tracking across different product contexts.
