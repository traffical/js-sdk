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
  apiKey: 'sk_...',
  
  // Optional
  apiBase: 'https://api.traffical.io', // Custom API endpoint
  cacheTtl: 60_000, // Config cache TTL in ms (default: 60s)
  timeout: 5_000, // Request timeout in ms (default: 5s)
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
  batchSize: 100,      // Events per batch (default: 100)
  flushInterval: 5000, // Flush interval in ms (default: 5s)
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

## License

MIT

