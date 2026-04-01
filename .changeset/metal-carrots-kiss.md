---
"@traffical/js-client": patch
"@traffical/svelte": patch
---

Make params a deep $state proxy so destructuring is safe. const { params } = useTraffical(...) now stays reactive. Fix useTrafficalPlugin to remove $derived.by warning.
