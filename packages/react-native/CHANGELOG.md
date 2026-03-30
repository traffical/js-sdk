# @traffical/react-native

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
