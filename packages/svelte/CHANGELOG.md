# @traffical/svelte

## 0.2.4

### Patch Changes

- c71c3ad: feat(js-client): add attributionMode option for track events
- Updated dependencies [c71c3ad]
  - @traffical/js-client@0.2.3

## 0.2.3

### Patch Changes

- 04763ce: Fix SSR fetch warning: defer client initialization to onMount

  Previously, `initialize()` was called synchronously during component
  creation, triggering SvelteKit's "Avoid calling fetch eagerly during
  server-side rendering" warning.

  Now:

  - Client is created during SSR but `initialize()` is NOT called
  - `initialize()` is called in `onMount()` (client-side only)
  - If `initialBundle` is provided, the SDK is immediately ready without fetch
  - Background refresh happens only on the client

  This allows proper SSR with pre-fetched bundles from load functions.

## 0.2.2

### Patch Changes

- 3e14c53: Testing, back to using changesets.
- Updated dependencies [3e14c53]
  - @traffical/core@0.2.2
  - @traffical/js-client@0.2.2
  - @traffical/node@0.2.2

## 0.2.1

### Patch Changes

- f4d7b71: Fix broken workspace dependencies from 0.2.0 release. Now using custom publish workflow that properly resolves workspace:^ to actual versions during bun publish.
- Updated dependencies [f4d7b71]
  - @traffical/core@0.2.1
  - @traffical/js-client@0.2.1
  - @traffical/node@0.2.1

## 0.2.0

### Minor Changes

- f4c9288: Harmonize all package versions to 0.2.0. This release includes:
  - Fixed package exports pointing to compiled JavaScript (not TypeScript source)
  - Workspace dependencies for better monorepo release coordination
  - Full SvelteKit SSR support via @traffical/svelte/server

### Patch Changes

- Updated dependencies [f4c9288]
  - @traffical/core@0.2.0
  - @traffical/js-client@0.2.0
  - @traffical/node@0.2.0

## 0.1.6

### Patch Changes

- 9920299: Update dependency versions to require fixed versions of @traffical/core and @traffical/node with proper JavaScript exports.

## 0.1.5

### Patch Changes

- 8471424: Fix package exports to point to compiled JavaScript files instead of TypeScript source files. This resolves Vite dependency optimization errors when using the SDK in SvelteKit projects.

## 0.1.2

### Patch Changes

- 362cf8d: fix: use npm version ranges instead of workspace protocol for dependencies
- Updated dependencies [362cf8d]
  - @traffical/js-client@0.1.4

## 0.1.1

### Patch Changes

- 7ec6faf: fix: replace workspace:^ with actual version numbers for npm publishing
- 6dc6740: Test changeset bump again
- Updated dependencies [7ec6faf]
- Updated dependencies [6dc6740]
  - @traffical/js-client@0.1.3
  - @traffical/core@0.1.3

## 0.1.1

### Patch Changes

- ec74054: Test npm changeset bump again
- f525104: Testing npm publishing
- Updated dependencies [ec74054]
- Updated dependencies [f525104]
  - @traffical/core@0.1.3
  - @traffical/js-client@0.1.3
