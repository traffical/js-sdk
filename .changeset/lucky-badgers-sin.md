---
"@traffical/js-client": minor
"@traffical/node": patch
---

Add global instance discovery (window.**TRAFFICAL_INSTANCES**) and late plugin initialization support. client.use() now fires onInitialize/onConfigUpdate immediately for already-initialized clients, enabling DevTools to attach debug plugins to running SDK instances. Auto-generate SDK_VERSION from package.json.
