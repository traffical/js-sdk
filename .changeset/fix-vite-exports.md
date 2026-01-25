---
"@traffical/svelte": patch
---

Fix package exports to point to compiled JavaScript files instead of TypeScript source files. This resolves Vite dependency optimization errors when using the SDK in SvelteKit projects.

