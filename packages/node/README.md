# @traffical/node

Traffical SDK for Node.js - server-side parameter resolution with caching and event tracking.

## Installation

```bash
npm install @traffical/node
# or
bun add @traffical/node
```

## Quick Start

```typescript
import { TrafficalClient } from '@traffical/node';

const client = new TrafficalClient({
  apiKey: 'sk_...', // Server-side API key
});

// Get parameters for a user
const decision = await client.decide({
  userId: 'user-123',
  country: 'US',
});

console.log(decision.params);
// { 'button.color': '#007bff', 'pricing.discount': 0.1 }

// Track an event
await client.track('purchase', {
  decisionId: decision.decisionId,
  unitKey: 'user-123',
  properties: {
    amount: 99.99,
    currency: 'USD',
  },
});
```

## Configuration

```typescript
const client = new TrafficalClient({
  // Required
  orgId: 'org_...',
  projectId: 'proj_...',
  env: 'production',
  apiKey: 'sk_...',

  // Optional
  baseUrl: 'https://sdk.traffical.io', // Custom edge endpoint
  refreshIntervalMs: 60_000,   // Config refresh interval (default: 60000)
  batchSize: 10,               // Events per batch (default: 10)
                               //   (legacy alias: eventBatchSize)
  flushIntervalMs: 30_000,     // Flush interval (default: 30000)
                               //   (legacy alias: eventFlushIntervalMs)
  configTimeoutMs: 10_000,     // Config-fetch timeout (default: 10000)
  eventsTimeoutMs: 10_000,     // Event-delivery timeout (default: 10000)
  resolveTimeoutMs: 5_000,     // Server-resolve timeout (default: 5000)
                               //   (legacy fallback for all three: requestTimeoutMs)
});
```

## API Reference

### `decide(context)`

Resolves parameters for a given context.

```typescript
const decision = await client.decide({
  userId: 'user-123',     // Required: unit key for bucketing
  country: 'US',          // Optional: targeting context
  plan: 'premium',        // Optional: more context
});

// Returns:
{
  decisionId: 'dec_...',  // Unique ID for this decision
  params: {               // Resolved parameters
    'feature.enabled': true,
    'ui.theme': 'dark',
  },
  exposures: [...]        // Which experiments the user is in
}
```

### `track(event, options)`

Tracks a user event for analytics.

```typescript
await client.track('purchase', {
  decisionId: decision.decisionId,
  unitKey: 'user-123',
  properties: {
    amount: 99.99,
  },
});
```

### `refresh()`

Forces a refresh of the cached configuration.

```typescript
await client.refresh();
```

## Event Batching

The Node SDK automatically batches events for efficiency:

```typescript
const client = new TrafficalClient({
  apiKey: 'sk_...',
  batchSize: 10,          // Events per batch (default: 10)
  flushIntervalMs: 30000, // Flush interval in ms (default: 30s)
});

// Events are queued and sent in batches
client.track('page_view', { ... });
client.track('click', { ... });

// Force flush before shutdown
await client.flush();
```

## Error Handling

```typescript
try {
  const decision = await client.decide({ userId: 'user-123' });
} catch (error) {
  if (error.code === 'NETWORK_ERROR') {
    // Handle network issues - use defaults
  }
  if (error.code === 'INVALID_API_KEY') {
    // Handle auth issues
  }
}
```

## TypeScript

Full TypeScript support with type inference:

```typescript
import type { Context, DecisionResult } from '@traffical/node';

const context: Context = {
  userId: 'user-123',
  plan: 'premium',
};

const decision: DecisionResult = await client.decide(context);
```

## Type-Safe Event Tracking

Use `@traffical/cli generate-types` to generate TypeScript interfaces for your event schemas. This lets you create a strictly typed `track` wrapper that catches invalid event names and properties at compile time.

### 1. Generate types

```bash
bunx @traffical/cli generate-types
```

### 2. Create a typed wrapper

```typescript
import type { TrafficalEventProperties } from './traffical.generated';
import { TrafficalClient } from '@traffical/node';

type TypedTrack = <E extends Extract<keyof TrafficalEventProperties, string>>(
  event: E,
  options: {
    decisionId: string;
    unitKey: string;
    properties?: TrafficalEventProperties[E];
  }
) => Promise<void>;

const client = new TrafficalClient({ apiKey: 'sk_...' });
export const track = client.track.bind(client) as unknown as TypedTrack;
```

### 3. Use it

```typescript
await track('purchase', {
  decisionId: decision.decisionId,
  unitKey: 'user-123',
  properties: {
    order_total: 99.99,
    payment_method: 'visa',
  },
}); // ✅

await track('purchase', {
  decisionId: decision.decisionId,
  unitKey: 'user-123',
  properties: {
    order_total: 99.99,
    unknown_field: true, // ❌ Type error
  },
});
```

---

## License

MIT

