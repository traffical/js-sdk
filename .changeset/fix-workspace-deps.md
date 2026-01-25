---
"@traffical/core": patch
"@traffical/js-client": patch
"@traffical/node": patch
"@traffical/react": patch
"@traffical/svelte": patch
---

Fix broken workspace dependencies from 0.2.0 release. Now using custom publish workflow that properly resolves workspace:^ to actual versions during bun publish.

