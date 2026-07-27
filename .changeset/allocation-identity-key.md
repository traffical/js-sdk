---
"@traffical/core": patch
---

Resolve contextual-model coefficients by allocation `key`, not display `name` (spec 0.8.0, S10).

An allocation carries two labels: `key` is the identifier — the value written to the warehouse `allocation_name` column and emitted as `layers[].allocationKey` — and `name` is a display label. `contextualModel.coefficients` is keyed by `key`, but this engine looked the coefficients up by `name`.

Where an author's variant name differed from its key (`"Treatment A"` vs `"treatment-a"`), the lookup missed, that arm scored `defaultAllocationScore`, and the trained model degraded toward a uniform softmax — silently. Nothing errored, the policy kept serving, and the reported model stayed "trained". When *every* allocation's name differed, all arms missed equally, the distribution was exactly uniform, and even a sample-ratio check passed: the bandit was inert with nothing anywhere reporting it.

Resolution is now `key ?? name`, so bundles produced before `key` existed keep working unchanged.

Also:

- `BundleAllocation.key` and `BundlePolicy.key` are now declared on the bundle types. Both were already emitted by the control plane and read back through `as any` casts to populate `allocationKey` / `policyKey`; those casts are gone.
- Conformance: the spec's `bundle_contextual_key_differs` vector is wired into the 0.7.0 suite, which now also asserts per-policy `allocationKey` and logged propensity.

No behavior change for bundles whose allocation names already equal their keys.
