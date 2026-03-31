---
"@traffical/js-client": minor
"@traffical/react-native": patch
"@traffical/svelte": patch
"@traffical/react": patch
---

Add onOverridesChange() listener to TrafficalClient for reactive parameter overrides. Framework providers (React, Svelte, React Native) now automatically re-evaluate params/decisions when overrides change via DevTools debug plugin.
