---
"@traffical/openfeature-web": patch
---

Fix `TrafficalWebProvider.track` arity — browser exposures and reward values were being dropped

The provider declared `track(name, details)`, but the provider-side contract
(`CommonProvider.track` in `@openfeature/core`) is `track(name, context, details)`:
the application calls `client.track(name, details)` and the SDK injects the bound
evaluation context before calling the provider. The provider was therefore reading
the **context** as its details, so:

- every `$traffical.exposure` lost its `flagKey`, missed the decision memo and was
  dropped — leaving treatment-on-the-treated metrics, the SRM health gate and bandit
  training silently empty for every browser integration;
- every reward lost its numeric `value`, and carried the context's fields as
  properties instead of the caller's details.

`track` now takes the context and derives the reward unit key from the targeting key
the SDK hands it (falling back to the bound context, then the client's stable id).
The class implements `Provider` only — the `Tracking` interface exported by the web
SDK is the *client*-side one, and a provider claiming to implement it ends up with
the wrong arity.

TypeScript could not catch this: a function with fewer parameters is assignable to
one with more. The regression guard is therefore a test that drives
`OpenFeature.getClient().track(...)` through the provider and asserts the `flagKey`
and reward `value` survive — the server provider already had such a test, which is
why its arity was correct. Do not replace it with a direct `provider.track(...)` call.

Callers who invoked `provider.track(...)` directly (rather than through the
OpenFeature client) must add the context argument.
