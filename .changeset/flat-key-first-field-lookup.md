---
"@traffical/core": patch
---

Condition field lookup now tries the literal (flat) context key first, then falls back to dot-path traversal (sdk-spec "Field lookup"). A condition on `url.pathname` matches both a flat `"url.pathname"` key — the shape the redirect plugin injects, which previously never matched — and a nested `{ url: { pathname } }` object; when both are present the flat key wins. `filteredContext` (context-logging allow-list) uses the same lookup, so a dotted `allowedFields` entry captures the nested value. `getNestedValue` is now exported.
