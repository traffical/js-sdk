---
"@traffical/core": patch
"@traffical/node": patch
"@traffical/react": patch
---

Remove broken "bun" export condition from package.json exports map. The condition pointed to ./src/index.ts which is not included in the published npm tarball (only dist/ is shipped), causing a hard "Cannot find module" error for any Bun user consuming these packages from npm.
