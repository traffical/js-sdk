---
"@traffical/openfeature-server": patch
---

Export `EXPOSURE_EVENT_NAME` (and the shared contract types) from the package entry

The README documents `import { EXPOSURE_EVENT_NAME } from "@traffical/openfeature-server"`,
but the package never re-exported it — the documented import failed to compile, and
integrators had to either reach into `@traffical/openfeature-core` (an undeclared,
transitive dependency for them) or hard-code the `"$traffical.exposure"` string.

The entry point now mirrors `@traffical/openfeature-web`, re-exporting
`EXPOSURE_EVENT_NAME` and `FLAG_METADATA_PREFIX` plus the `TrafficalProviderOptions`,
`TrafficalClientLike` and `OFFlagType` types. `TrafficalProviderOptions` in particular
appears in the public signatures of the provider constructor and
`createTrafficalServerProvider`, so it could not previously be named by callers.

No behaviour change. The guard is a test that imports the constants from `./index.js`
— the entry consumers actually resolve — rather than from `@traffical/openfeature-core`,
which is what let the gap go unnoticed.
