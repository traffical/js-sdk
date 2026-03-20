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

When building assignment definitions in the Traffical dashboard, map your warehouse columns to these fields.

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

This tracks an `"Experiment Assignment"` event with properties: `unit_key`, `policy_key`, `allocation_key`, `timestamp`, `policy_id`, `allocation_name`, `layer_id`, `org_id`, `project_id`, `env`, plus any values from `entry.properties`.

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

When enabled (the default), the SDK deduplicates logger calls within the session: the same combination of `unitKey` + `policyId` + `allocationName` will only fire `assignmentLogger` once until the session TTL expires.

Set to `false` if you need a row for every `decide()` / `trackExposure()` invocation (e.g., for audit logging). Be mindful of volume.

Dedup keys are held **in memory per session** — they do not persist across page reloads or sessions.

### Relation to exposure deduplication

Assignment logger deduplication and cloud exposure deduplication are **independent**:

- **Cloud exposure events:** controlled by the built-in exposure deduplicator (active when `disableCloudEvents` is `false`).
- **Assignment logger:** controlled by `deduplicateAssignmentLogger`.

---

## When does `assignmentLogger` fire?

- **`decide()`** — after resolving parameters, the logger fires once per layer that has a matched experiment and variant (subject to dedup).
- **`trackExposure()`** — also fires the logger for each matched layer. If both `decide()` and `trackExposure()` are called for the same decision, `deduplicateAssignmentLogger: true` (default) prevents double logging.

The logger is **not** called when `unitKey` is missing from the decision metadata.

---

## Type imports

```ts
import type { AssignmentLogEntry, AssignmentLogger } from "@traffical/core";
import { createWarehouseNativeLoggerPlugin } from "@traffical/js-client";
```

---

## Further reading

- [Traffical documentation](https://docs.traffical.io)
- [Dashboard — Project Settings](https://dashboard.traffical.io)
