---
"@traffical/js-client": patch
---

Add parameter override API for debug tooling. Client maintains an internal override map applied post-resolution in decide() and getParams(). Exposed via PluginClientAPI (applyOverrides, clearOverrides, getOverrides) for plugin-only access — not a public user-facing API. Debug plugin delegates override operations to the client instead of mutating hook arguments.
