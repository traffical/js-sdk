---
"@traffical/js-client": minor
"@traffical/react-native": patch
"@traffical/svelte": patch
"@traffical/react": patch
---

Add identify() API for mid-session identity changes. client.identify(unitKey) updates the stable ID and notifies all framework providers (React, Svelte, React Native), causing automatic re-evaluation and UI updates. Useful for login/logout flows and Traffical DevTools. Debug plugin now uses identify() instead of setStableId().
