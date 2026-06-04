# @traffical/core-io

## 0.6.0

### Minor Changes

- 24ffc0a: Switch deterministic assignment from FNV-1a to the SHA-256 v2 hash.

### Patch Changes

- Updated dependencies [24ffc0a]
  - @traffical/core@0.10.0

## 0.5.3

### Patch Changes

- Updated dependencies [0181040]
- Updated dependencies [0181040]
  - @traffical/core@0.9.0

## 0.5.2

### Patch Changes

- Updated dependencies [0a58b77]
- Updated dependencies [96eb276]
- Updated dependencies [87b30d6]
  - @traffical/core@0.8.0

## 0.5.1

### Patch Changes

- Updated dependencies [d71ae22]
  - @traffical/core@0.7.0

## 0.5.0

### Minor Changes

- f0f31bc: Add type-safe event tracking and dev-mode schema warnings
- aebc425: Add typed event tracking with schema-aware clients. All SDK clients now accept an optional `TrafficalEvents` type parameter for compile-time validation of event names and properties in `track()` calls. Event loggers and batchers surface schema validation warnings from the edge API via a new `onSchemaWarnings` callback, enabling dev-mode visibility into tracking plan violations.

### Patch Changes

- Updated dependencies [f0f31bc]
- Updated dependencies [aebc425]
  - @traffical/core@0.6.0

## 0.4.0

### Minor Changes

- 23925fe: Add warehouse-native assignment logging and sync support with AssignmentLogger callback, batched warehouse-native-logger plugin, and managed server-side sync

### Patch Changes

- Updated dependencies [23925fe]
  - @traffical/core@0.5.0

## 0.3.1

### Patch Changes

- Updated dependencies [7c95577]
  - @traffical/core@0.4.0

## 0.3.0

### Minor Changes

- e90a26c: Add server-evaluated mode with unified /v1/resolve endpoint, DecisionClient, and evaluationMode option.

### Patch Changes

- Updated dependencies [e90a26c]
  - @traffical/core@0.3.0
