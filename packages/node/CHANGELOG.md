# @traffical/node

## 0.2.0

### Minor Changes

- f4c9288: Harmonize all package versions to 0.2.0. This release includes:
  - Fixed package exports pointing to compiled JavaScript (not TypeScript source)
  - Workspace dependencies for better monorepo release coordination
  - Full SvelteKit SSR support via @traffical/svelte/server

### Patch Changes

- Updated dependencies [f4c9288]
  - @traffical/core@0.2.0

## 0.1.5

### Patch Changes

- b1eee70: Fix package exports to point to compiled JavaScript files instead of TypeScript source files. This resolves Node.js runtime errors (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING) and Vite dependency optimization failures when using these packages.
- Updated dependencies [b1eee70]
  - @traffical/core@0.1.4

## 0.1.4

### Patch Changes

- 362cf8d: fix: use npm version ranges instead of workspace protocol for dependencies

## 0.1.3

### Patch Changes

- 7ec6faf: fix: replace workspace:^ with actual version numbers for npm publishing
- 6dc6740: Test changeset bump again
- Updated dependencies [6dc6740]
  - @traffical/core@0.1.3

## 0.1.3

### Patch Changes

- ec74054: Test npm changeset bump again
- f525104: Testing npm publishing
- Updated dependencies [ec74054]
- Updated dependencies [f525104]
  - @traffical/core@0.1.3
