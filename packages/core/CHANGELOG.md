# @traffical/core

## 0.2.4

### Patch Changes

- 637e1d4: Fix incomplete layer resolution when no parameters match a layer. The resolution engine now processes all layers for bucket/policy/allocation matching regardless of requested parameters, populating `decision.metadata.layers` exhaustively for attribution and assignment tracking. Layers without matching parameters are marked `attributionOnly: true`. Exposure tracking in js-client skips attribution-only layers to prevent exposure inflation.

## 0.2.3

### Patch Changes

- 8cea5c1: Remove broken "bun" export condition from package.json exports map. The condition pointed to ./src/index.ts which is not included in the published npm tarball (only dist/ is shipped), causing a hard "Cannot find module" error for any Bun user consuming these packages from npm.

## 0.2.2

### Patch Changes

- 3e14c53: Testing, back to using changesets.

## 0.2.1

### Patch Changes

- f4d7b71: Fix broken workspace dependencies from 0.2.0 release. Now using custom publish workflow that properly resolves workspace:^ to actual versions during bun publish.

## 0.2.0

### Minor Changes

- f4c9288: Harmonize all package versions to 0.2.0. This release includes:
  - Fixed package exports pointing to compiled JavaScript (not TypeScript source)
  - Workspace dependencies for better monorepo release coordination
  - Full SvelteKit SSR support via @traffical/svelte/server

## 0.1.4

### Patch Changes

- b1eee70: Fix package exports to point to compiled JavaScript files instead of TypeScript source files. This resolves Node.js runtime errors (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING) and Vite dependency optimization failures when using these packages.

## 0.1.3

### Patch Changes

- 6dc6740: Test changeset bump again

## 0.1.3

### Patch Changes

- ec74054: Test npm changeset bump again
- f525104: Testing npm publishing
