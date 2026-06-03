# @traffical/core

## 0.8.0

### Minor Changes

- 0a58b77: Add warehouse-native assignment fields to the BYO assignmentLogger.
- 87b30d6: feat(sdk): add type, decisionId, anonymousId, id to assignmentLogger entries

### Patch Changes

- 96eb276: Canonicalize FNV-1a hashing over UTF-8 bytes for deterministic bucketing

## 0.7.0

### Minor Changes

- d71ae22: Add per-layer unit key support for multi-entity randomization. `BundleLayer` now accepts an optional `unitKey` override, and `LayerResolution` exposes `unitKey` / `unitKeyValue` on exposure events. The resolution engine resolves the unit key per layer, falling back to the bundle-level default.

## 0.6.0

### Minor Changes

- f0f31bc: Add type-safe event tracking and dev-mode schema warnings
- aebc425: Add typed event tracking with schema-aware clients. All SDK clients now accept an optional `TrafficalEvents` type parameter for compile-time validation of event names and properties in `track()` calls. Event loggers and batchers surface schema validation warnings from the edge API via a new `onSchemaWarnings` callback, enabling dev-mode visibility into tracking plan violations.

## 0.5.0

### Minor Changes

- 23925fe: Add warehouse-native assignment logging and sync support with AssignmentLogger callback, batched warehouse-native-logger plugin, and managed server-side sync

## 0.4.0

### Minor Changes

- 7c95577: Add SDK-side contextual bandit scoring — reads policy.contextualModel from the bundle, computes per-allocation scores via linear dot-product, applies softmax with gamma temperature and probability floor, and deterministically selects an allocation

## 0.3.0

### Minor Changes

- e90a26c: Add server-evaluated mode with unified /v1/resolve endpoint, DecisionClient, and evaluationMode option.

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
