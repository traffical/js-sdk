# @traffical/openfeature-web

OpenFeature **web** (static-context) [provider](https://openfeature.dev/) backed by the Traffical browser SDK (`@traffical/js-client`).

Resolvers are synchronous and evaluate against a single **bound static context** (the current user/session). Each resolution runs one Traffical `decide()` (the intent-to-treat / ITT decision); exposure is a separate, explicit render-time signal — so treatment-on-the-treated (ToT) metrics, the SRM health gate, and bandit optimization measure what the user actually saw.

## Install

```bash
npm install @traffical/openfeature-web @openfeature/web-sdk @traffical/js-client
```

`@openfeature/web-sdk` and `@traffical/js-client` are peer dependencies.

## Register the provider

Construct your Traffical browser client, wrap it in the provider, and set it on OpenFeature with the initial context. The caller owns the client lifecycle.

```ts
import { OpenFeature } from "@openfeature/web-sdk";
import { TrafficalClient } from "@traffical/js-client";
import { TrafficalWebProvider } from "@traffical/openfeature-web";

const client = new TrafficalClient({ apiKey: "pk_...", /* ... */ });

await OpenFeature.setContext({ targetingKey: user.id, plan: user.plan });
await OpenFeature.setProviderAndWait(new TrafficalWebProvider(client));

const of = OpenFeature.getClient();
```

### Static context

The provider evaluates against the context bound via `OpenFeature.setContext(...)` — resolvers ignore any per-call context argument. On a context change (e.g. login/logout) the provider re-binds the context, **clears its decision memo** (so a decision made under the old identity is never served or exposed under the new one), flows the new identity into the client, and returns — letting the web SDK emit the reconcile lifecycle events.

## Resolve a flag

```ts
const enabled = of.getBooleanValue("checkout.newFlow", false);
const color = of.getStringValue("ui.color", "blue");
```

Resolvers are synchronous. The `variant`, `reason` (`SPLIT` when a variant was assigned, else `DEFAULT`), and scalar `traffical.*` `flagMetadata` come from the decision.

## Exposure — the `$traffical.exposure` convention

Exposure (ToT) is **explicit**: fire it at your render site once the user actually sees the treatment. Use the reserved event name `$traffical.exposure` (exported as `EXPOSURE_EVENT_NAME`) and echo the `flagKey` in the details:

```ts
import { EXPOSURE_EVENT_NAME } from "@traffical/openfeature-web";

of.track(EXPOSURE_EVENT_NAME, { flagKey: "checkout.newFlow" });
```

The provider stitches this to the memoized decision for that flag in the current context and calls the native `trackExposure()`. It **never re-decides** in the exposure path — a miss (flag not resolved in this context) warns once and no-ops.

Every other `track(name, details)` is a business/reward event, forwarded to the client's `track()` joined on the bound targeting key (falling back to the client's anonymous stable id). A numeric `details.value` is lifted out as the reward value.

> Web `Tracking` takes **no context argument** — identity comes from the bound static context.

### No-exposure alarm

If the provider records many decisions but zero exposures, it fires a one-shot warning and a non-fatal provider `Error` event, since ToT/SRM/optimization would be silently empty. Instrument `$traffical.exposure`, or set `exposureOnResolve`.

## Options

`new TrafficalWebProvider(client, options)`:

| Option | Description |
| --- | --- |
| `exposureOnResolve` | When `true`, the resolver fires `trackExposure()` on the just-made decision (collapsing ToT toward ITT). |
| `unitKey` | Override the context field the bundle buckets on. Defaults to `client.getUnitKeyField()` (the bundle's `hashing.unitKey`). |
| `exposureEventName` | Override the reserved exposure event name. Defaults to `$traffical.exposure`. |
| `gatePropensity` | Omit `traffical.propensity` from `flagMetadata`. **Defaults to `true` on web.** |

> On web, `flagMetadata` is visible in browser devtools, so the provider always gates **both** `traffical.propensity` and `traffical.modelVersion` out — bandit selection internals never leak to the client.

## targetingKey → unit-key mapping

The bound `targetingKey` is written under the bundle's **actual** bucketing field (`hashing.unitKey`), not a literal `"targetingKey"` field — otherwise the client's context enrichment would overwrite it with the anonymous stable id and silently mis-bucket the unit. A missing/empty targeting key throws `TargetingKeyMissingError`, which the OpenFeature SDK maps to the default with `reason: ERROR`.
