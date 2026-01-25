---
"@traffical/svelte": patch
---

Fix SSR fetch warning: defer client initialization to onMount

Previously, `initialize()` was called synchronously during component
creation, triggering SvelteKit's "Avoid calling fetch eagerly during
server-side rendering" warning.

Now:
- Client is created during SSR but `initialize()` is NOT called
- `initialize()` is called in `onMount()` (client-side only)
- If `initialBundle` is provided, the SDK is immediately ready without fetch
- Background refresh happens only on the client

This allows proper SSR with pre-fetched bundles from load functions.
