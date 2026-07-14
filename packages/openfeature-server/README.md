# @traffical/openfeature-server

OpenFeature **server** (dynamic-context) [provider](https://openfeature.dev/) backed by the Traffical Node SDK.

Each flag resolution runs one Traffical `decide()` (the intent-to-treat / ITT decision), and exposure is a separate, explicit render-time signal — so your treatment-on-the-treated (ToT) metrics, SRM health gate, and bandit optimization measure what users actually saw, not merely what was decided.

## Install

```bash
npm install @traffical/openfeature-server @openfeature/server-sdk @traffical/node
```

`@openfeature/server-sdk` and `@traffical/node` are peer dependencies.

## Register the provider

Construct your Traffical Node client yourself, wrap it in the provider, and set it on OpenFeature. The caller owns the client lifecycle; the provider is a thin translation layer over it.

```ts
import { OpenFeature } from "@openfeature/server-sdk";
import { TrafficalClient } from "@traffical/node";
import { TrafficalServerProvider } from "@traffical/openfeature-server";

const client = new TrafficalClient({
  orgId: "org_123",
  projectId: "proj_456",
  env: "production",
  apiKey: process.env.TRAFFICAL_API_KEY!,
});
await OpenFeature.setProviderAndWait(new TrafficalServerProvider(client));

const of = OpenFeature.getClient();
```

### Wrap each request

Wrap every request in `provider.runInRequest(...)` so resolve, exposure, and reward calls share **one request-scoped decision store**. This is what lets the exposure/reward paths find the exact decision the caller saw — without ever re-deciding — and prevents cross-unit bleed under concurrency.

```ts
const provider = new TrafficalServerProvider(client);
await OpenFeature.setProviderAndWait(provider);

app.use((req, res, next) => provider.runInRequest(next));
```

Without it, the provider falls back to a bounded, TTL'd per-key cache and warns once (exposure/reward may miss under concurrency).

## Resolve a flag

```ts
const ctx = { targetingKey: user.id, plan: user.plan };

const enabled = await of.getBooleanValue("checkout.newFlow", false, ctx);
const color = await of.getStringValue("ui.color", "blue", ctx);
```

The resolution `variant`, `reason` (`SPLIT` when a variant was assigned, else `DEFAULT`), and scalar `traffical.*` `flagMetadata` (decision id, policy/allocation keys, bucket, propensity, config version) come straight from the decision.

## Exposure — the `$traffical.exposure` convention

Exposure (ToT) is **explicit**: fire it at your render site, once you know the user actually saw the treatment. Use the reserved event name `$traffical.exposure` (exported as `EXPOSURE_EVENT_NAME`) and echo the `flagKey` in the event details:

```ts
import { EXPOSURE_EVENT_NAME } from "@traffical/openfeature-server";

of.track(EXPOSURE_EVENT_NAME, ctx, { flagKey: "checkout.newFlow" });
```

The provider stitches this to the decision already made for that flag in the same request and calls the native `trackExposure()`. It **never re-decides** in the exposure path — if no matching decision is found (e.g. the flag wasn't resolved earlier in the request), it warns once and no-ops.

Every other `track(name, ctx, details)` is treated as a business/reward event and forwarded to the client's `track()`, joined on the unit key from `ctx.targetingKey`. A numeric `details.value` is lifted out as the reward value.

### No-exposure alarm

If the provider records many decisions but zero exposures, it fires a one-shot warning and a non-fatal provider `Error` event — because ToT metrics, SRM health checks, and bandit optimization would all be silently empty. Either instrument `$traffical.exposure` at your render sites, or set `exposureOnResolve` (below).

## Options

`new TrafficalServerProvider(client, options)`:

| Option | Description |
| --- | --- |
| `exposureOnResolve` | When `true`, the resolver fires `trackExposure()` on the just-made decision (collapsing ToT toward ITT). Escape hatch for teams that can't instrument explicit render-time exposures. |
| `unitKey` | Override the context field the bundle buckets on. Defaults to `client.getUnitKeyField()` (the bundle's `hashing.unitKey`). |
| `exposureEventName` | Override the reserved exposure event name. Defaults to `$traffical.exposure`. Change only to avoid a collision with a real business event. |
| `gatePropensity` | When `true`, omit `traffical.propensity` from `flagMetadata`. |

## targetingKey → unit-key mapping

The OpenFeature `targetingKey` is written under the bundle's **actual** bucketing field (`hashing.unitKey`), not a literal `"targetingKey"` field — otherwise the client would mis-bucket the unit. A missing/empty targeting key throws `TargetingKeyMissingError`, which the OpenFeature SDK maps to the default with `reason: ERROR`.
