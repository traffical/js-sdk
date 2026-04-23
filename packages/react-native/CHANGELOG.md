# @traffical/react-native

## 0.5.0

### Minor Changes

- f0f31bc: Add type-safe event tracking and dev-mode schema warnings
- aebc425: Add typed event tracking with schema-aware clients. All SDK clients now accept an optional `TrafficalEvents` type parameter for compile-time validation of event names and properties in `track()` calls. Event loggers and batchers surface schema validation warnings from the edge API via a new `onSchemaWarnings` callback, enabling dev-mode visibility into tracking plan violations.

### Patch Changes

- Updated dependencies [f0f31bc]
- Updated dependencies [aebc425]
  - @traffical/core@0.6.0
  - @traffical/js-client@0.11.0

## 0.4.7

### Patch Changes

- Updated dependencies [5e44fed]
  - @traffical/js-client@0.10.1

## 0.4.6

### Patch Changes

- 5ddb821: Add onOverridesChange() listener to TrafficalClient for reactive parameter overrides. Framework providers (React, Svelte, React Native) now automatically re-evaluate params/decisions when overrides change via DevTools debug plugin.
- Updated dependencies [5ddb821]
  - @traffical/js-client@0.10.0

## 0.4.5

### Patch Changes

- Updated dependencies [fcc170e]
  - @traffical/js-client@0.9.2

## 0.4.4

### Patch Changes

- Updated dependencies [2645cbc]
  - @traffical/js-client@0.9.1

## 0.4.3

### Patch Changes

- 9d1868d: Add identify() API for mid-session identity changes. client.identify(unitKey) updates the stable ID and notifies all framework providers (React, Svelte, React Native), causing automatic re-evaluation and UI updates. Useful for login/logout flows and Traffical DevTools. Debug plugin now uses identify() instead of setStableId().
- Updated dependencies [9d1868d]
  - @traffical/js-client@0.9.0

## 0.4.2

### Patch Changes

- Updated dependencies [dc1ca31]
  - @traffical/js-client@0.8.0

## 0.4.1

### Patch Changes

- Updated dependencies [6cf30cd]
  - @traffical/js-client@0.7.0

## 0.4.0

### Minor Changes

- 23925fe: Add warehouse-native assignment logging and sync support with AssignmentLogger callback, batched warehouse-native-logger plugin, and managed server-side sync

### Patch Changes

- Updated dependencies [23925fe]
  - @traffical/js-client@0.6.0
  - @traffical/core@0.5.0

## 0.3.2

### Patch Changes

- Updated dependencies [7c95577]
  - @traffical/core@0.4.0
  - @traffical/js-client@0.5.1

## 0.3.1

### Patch Changes

- Updated dependencies [e0a2791]
  - @traffical/js-client@0.5.0

## 0.3.0

### Minor Changes

- 7175509: Add server-mode re-resolve on identity change via resolveVersion

## 0.2.0

### Minor Changes

- 119eacb: Add @traffical/react-native SDK with server-evaluated resolution, AsyncStorage caching, and AppState lifecycle. Export LifecycleProvider abstraction from js-client.

### Patch Changes

- Updated dependencies [119eacb]
  - @traffical/js-client@0.4.0
