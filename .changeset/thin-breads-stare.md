---
"@traffical/core": minor
"@traffical/core-io": minor
"@traffical/js-client": minor
"@traffical/node": minor
"@traffical/react": minor
"@traffical/react-native": minor
"@traffical/svelte": minor
---

Add typed event tracking with schema-aware clients. All SDK clients now accept an optional `TrafficalEvents` type parameter for compile-time validation of event names and properties in `track()` calls. Event loggers and batchers surface schema validation warnings from the edge API via a new `onSchemaWarnings` callback, enabling dev-mode visibility into tracking plan violations.
