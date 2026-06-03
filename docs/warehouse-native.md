# Warehouse-Native Experimentation

Traffical supports **warehouse-native metrics** — compute experiment results directly from assignments and facts that live in your data warehouse. The SDK plays a key role by logging which users were assigned to which experiment variants.

There are two ways to get assignment data into your warehouse:

1. **Traffical-managed sync** — the SDK sends events to Traffical as usual; Traffical automatically syncs them into your connected warehouse.
2. **Bring-your-own (BYO) assignment logging** — you route structured assignment rows through your own pipeline (Segment, RudderStack, a custom API, etc.) without Traffical ever storing them.

This guide covers `@traffical/js-client`. The same options are available on `TrafficalClientOptions` in `@traffical/core` for Node and other runtimes.

---

## Choosing an integration mode

| Mode | How assignments reach the warehouse | SDK setup |
|------|-------------------------------------|-----------|
| **Managed sync** | Traffical receives events → syncs to your warehouse on a schedule | Default — no extra SDK config needed |
| **BYO `assignmentLogger`** | Your pipeline (CDP, HTTP, database) | Pass an `assignmentLogger` callback; optionally set `disableCloudEvents` |

Behavioral data like purchases and conversions typically already exist in your warehouse as **fact tables**. Assignments are the piece the SDK provides — either through managed sync or your own logger.

---

## Managed sync

If you're happy sending exposure events to Traffical, managed sync is the simplest path. No warehouse-specific SDK code is required.

1. Initialize `TrafficalClient` as usual.
2. Call `decide()` and `trackExposure()` — Traffical receives the events.
3. In the [Traffical dashboard](https://dashboard.traffical.io), connect your warehouse and enable SDK event sync under **Project Settings → Warehouse**.

Traffical will land assignment rows into your warehouse schema automatically. Your assignment definitions can then query those synced tables.

---

## BYO assignment logging

Use this when you already have a CDP pipeline, need to keep assignment data on your own infrastructure, or want full control over the data path.

Pass an `assignmentLogger` callback when creating the client:

```ts
import { TrafficalClient } from "@traffical/js-client";

const client = new TrafficalClient({
  orgId: "org_...",
  projectId: "prj_...",
  env: "production",
  apiKey: "your_sdk_key",
  assignmentLogger: (entry) => {
    // Forward to your HTTP API, Segment, RudderStack, etc.
  },
});
```

### `AssignmentLogEntry` fields

| Field | Description |
|-------|-------------|
| `unitKey` | The user/entity identifier used for bucketing |
| `policyId` | The experiment (policy) identifier |
| `policyKey` | Stable experiment key — use this for warehouse joins |
| `allocationName` | The variant the user was assigned to |
| `allocationKey` | Stable variant key — use this for warehouse joins |
| `timestamp` | ISO 8601 assignment time |
| `layerId` | Layer identifier |
| `orgId`, `projectId`, `env` | Scoping fields |
| `properties` | Evaluation context at assignment time — useful as covariates |
| `type` | `"decision"` or `"exposure"` — which call produced the row (matches the canonical event `type` discriminator) |
| `decisionId` | The decision that produced this assignment (`decision.decisionId`) |
| `anonymousId` | Anonymous/stable device id when available (client SDKs); `undefined` on the Node SDK |
| `id` | Unique id for this assignment log entry (`asn_…`) |

When building assignment definitions in the Traffical dashboard, map your warehouse columns to these fields.

---

## BYO event logging (`eventLogger`)

While `assignmentLogger` emits structured **assignment rows**, the `eventLogger`
callback receives the **full SDK events** — `exposure`, `track`, and `decision`
— mirroring what would otherwise be sent to the Traffical edge. Use it when you
want to route *all* product analytics (e.g. `add_to_cart`, `purchase`) plus
experiment exposures into your own pipeline.

```ts
import type { TrackableEvent } from "@traffical/core";
import { TrafficalClient } from "@traffical/js-client";

const client = new TrafficalClient({
  orgId: "org_...",
  projectId: "prj_...",
  env: "production",
  apiKey: "...",
  eventLogger: (event: TrackableEvent) => {
    // event.type is "exposure" | "track" | "decision"
  },
  disableCloudEvents: true, // send to your sink instead of the edge
});
```

Key behaviors:

- Fires for `exposure` (from `trackExposure()`), `track` (from `track()`), and
  `decision` (from `decide()`, when `trackDecisions` is enabled).
- Fires **regardless of `disableCloudEvents`**, so you can send to your sink
  instead of (with `disableCloudEvents: true`) or in addition to
  (`disableCloudEvents: false`, dual-write) the Traffical edge.
- Inherits the SDK's existing per-path dedup: exposures are deduplicated by the
  exposure deduplicator, decisions by the decision deduplicator, and `track`
  events are never deduplicated.

`eventLogger` and `assignmentLogger` are independent — set either or both.

---

## Unified factory: Segment, RudderStack, Jitsu

`createWarehouseNativeLogger` returns **both** loggers for a single destination,
so you can wire them together:

```ts
import { TrafficalClient, createWarehouseNativeLogger } from "@traffical/js-client";

const { assignmentLogger, eventLogger } = createWarehouseNativeLogger({
  destination: { type: "segment", analytics },
});

const client = new TrafficalClient({
  /* ... */
  assignmentLogger,
  eventLogger,
});
```

Supported destinations: `segment`, `rudderstack`, `jitsu`, and `custom`.
`createWarehouseNativeLoggerPlugin(...)` remains available as a back-compat
shortcut that returns only the `assignmentLogger`.

### Jitsu destination

The `jitsu` destination builds Segment-compatible payloads and POSTs them over
HTTP. By default the URL is `${host}/api/s/{type}` (client mode) or
`${host}/api/s/s2s/{type}` (server-to-server). Provide `endpoint` to target your
own proxy route, and `writeKey` to send the `X-Write-Key` header for s2s.

```ts
const { assignmentLogger, eventLogger } = createWarehouseNativeLogger({
  destination: {
    type: "jitsu",
    host: "/api/jitsu",
    mode: "s2s",
    endpoint: (type) => `/api/jitsu/${type}`, // your server proxy route
  },
});
```

> **Security note:** the Jitsu server write key is a secret. From the browser,
> POST to a server-side proxy that adds `X-Write-Key` (and, for s2s, fills
> `context.ip` / `context.userAgent`) rather than embedding the key client-side.

---

## Segment integration

Use the built-in `createWarehouseNativeLoggerPlugin` helper to emit `analytics.track()` calls with warehouse-friendly `snake_case` property names:

```ts
import { TrafficalClient, createWarehouseNativeLoggerPlugin } from "@traffical/js-client";

const client = new TrafficalClient({
  orgId: "org_...",
  projectId: "prj_...",
  env: "production",
  apiKey: "...",
  assignmentLogger: createWarehouseNativeLoggerPlugin({
    destination: { type: "segment", analytics },
    eventName: "Experiment Assignment", // default
  }),
});
```

This tracks an `"Experiment Assignment"` event with properties: `unit_key`, `policy_key`, `allocation_key`, `timestamp`, `policy_id`, `allocation_name`, `layer_id`, `org_id`, `project_id`, `env`, `type`, `decision_id`, `anonymous_id`, `assignment_id`, plus any values from `entry.properties`.

Load Segment's `analytics.js` as usual and pass the `analytics` object.

---

## RudderStack integration

The same helper works with RudderStack — only the `type` changes:

```ts
import { TrafficalClient, createWarehouseNativeLoggerPlugin } from "@traffical/js-client";

const client = new TrafficalClient({
  orgId: "org_...",
  projectId: "prj_...",
  env: "production",
  apiKey: "...",
  assignmentLogger: createWarehouseNativeLoggerPlugin({
    destination: { type: "rudderstack", analytics: rudderanalytics },
  }),
});
```

Configure your RudderStack destination to land events in the same warehouse you've connected in Traffical.

---

## Custom logger

For server-side or trusted environments, you can forward assignments to your own API:

```ts
import type { AssignmentLogEntry } from "@traffical/core";
import { TrafficalClient } from "@traffical/js-client";

async function insertAssignment(entry: AssignmentLogEntry) {
  await fetch("https://api.example.com/experiment-assignments", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer ..." },
    body: JSON.stringify({
      user_id: entry.unitKey,
      experiment_key: entry.policyKey,
      variant_key: entry.allocationKey,
      assigned_at: entry.timestamp,
      context: entry.properties ?? {},
    }),
  });
}

const client = new TrafficalClient({
  orgId: "org_...",
  projectId: "prj_...",
  env: "production",
  apiKey: "...",
  assignmentLogger: (entry) => void insertAssignment(entry),
});
```

> **Security note:** Never expose database credentials in browser-side code. Use a server-side proxy or API endpoint.

---

## Disabling cloud events

```ts
new TrafficalClient({
  // ...
  disableCloudEvents: true,
  assignmentLogger: myLogger,
});
```

When `disableCloudEvents` is `true`, the SDK stops sending decision, exposure, and track events to Traffical. Config fetching and `decide()` continue to work normally.

**Use this when:**

- Compliance requirements prohibit assignment data from leaving your infrastructure.
- You want to avoid double-counting events while running both managed and BYO paths.

> **Note:** Disabling cloud events also disables managed sync for those events. Always pair with a BYO logger or another ingestion path.

---

## Mixed mode: SDK assignments + warehouse facts

A common production pattern combines both pieces:

- **Assignments** — BYO logger → CDP → warehouse table.
- **Facts** — Tables already in your warehouse (orders, subscriptions, page views).
- **Metrics** — Traffical joins assignments to facts and computes experiment results.

If revenue data already exists in your warehouse, there's no need to call `track()` for purchases from the SDK. Define fact tables in the Traffical dashboard and attach metrics to them.

---

## Deduplication

### `deduplicateAssignmentLogger`

```ts
deduplicateAssignmentLogger?: boolean; // default: true
```

When enabled (the default), the SDK deduplicates logger calls within the session: the same combination of `unitKey` + `policyId` + `allocationName` + `type` will only fire `assignmentLogger` once until the session TTL expires. Because `type` participates in the dedup key, a single unit/policy/allocation can still emit both a `"decision"` row (from `decide()`) and an `"exposure"` row (from `trackExposure()`).

Set to `false` if you need a row for every `decide()` / `trackExposure()` invocation (e.g., for audit logging). Be mindful of volume.

Dedup keys are held **in memory per session** — they do not persist across page reloads or sessions.

### Relation to exposure deduplication

Assignment logger deduplication and cloud exposure deduplication are **independent**:

- **Cloud exposure events:** controlled by the built-in exposure deduplicator (active when `disableCloudEvents` is `false`).
- **Assignment logger:** controlled by `deduplicateAssignmentLogger`.

---

## When does `assignmentLogger` fire?

- **`decide()`** — after resolving parameters, the logger fires once per layer that has a matched experiment and variant, with `type: "decision"` (subject to dedup).
- **`trackExposure()`** — also fires the logger for each matched layer, with `type: "exposure"`. Because `type` is part of the dedup key, calling both `decide()` and `trackExposure()` for the same decision produces two distinct rows (one `"decision"`, one `"exposure"`), while repeated calls of the same kind are deduplicated.

The logger is **not** called when `unitKey` is missing from the decision metadata.

---

## Type imports

```ts
import type {
  AssignmentLogEntry,
  AssignmentLogger,
  TrackableEvent,
  TrackableEventLogger,
} from "@traffical/core";
import {
  createWarehouseNativeLogger,
  createWarehouseNativeLoggerPlugin,
} from "@traffical/js-client";
```

---

## Further reading

- [Traffical documentation](https://docs.traffical.io)
- [Dashboard — Project Settings](https://dashboard.traffical.io)
