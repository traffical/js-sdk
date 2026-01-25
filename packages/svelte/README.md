# @traffical/svelte

Traffical SDK for Svelte 5 applications. Provides reactive hooks and components for parameter resolution, A/B testing, and feature flags with full SSR/hydration support.

## Features

- **Svelte 5 Runes** - Uses `$state`, `$derived`, and `$effect` for reactive, fine-grained updates
- **Full SSR Support** - Pre-fetch config bundles in SvelteKit load functions
- **Hydration-Safe** - No FOOC (Flash of Original Content) with proper initialization
- **Feature Parity** - Same capabilities as the React SDK
- **Type-Safe** - Full TypeScript support with generic parameter types

## Installation

```bash
bun add @traffical/svelte
# or
npm install @traffical/svelte
# or
pnpm add @traffical/svelte
```

## Quick Start

### 1. Set up the Provider

In your root layout, initialize Traffical:

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import { TrafficalProvider } from '@traffical/svelte';
  import { PUBLIC_TRAFFICAL_API_KEY } from '$env/static/public';

  let { data, children } = $props();
</script>

<TrafficalProvider
  config={{
    orgId: 'org_123',
    projectId: 'proj_456',
    env: 'production',
    apiKey: PUBLIC_TRAFFICAL_API_KEY,
    initialBundle: data.traffical?.bundle,
  }}
>
  {@render children()}
</TrafficalProvider>
```

### 2. Use Parameters in Components

```svelte
<!-- src/routes/checkout/+page.svelte -->
<script lang="ts">
  import { useTraffical } from '@traffical/svelte';

  const { params, ready, track } = useTraffical({
    defaults: {
      'checkout.ctaText': 'Buy Now',
      'checkout.ctaColor': '#000000',
    },
  });

  function handlePurchase(amount: number) {
    // track has the decisionId already bound!
    track('purchase', { value: amount, orderId: 'ord_123' });
  }
</script>

{#if ready}
  <button
    style="background: {params['checkout.ctaColor']}"
    onclick={() => handlePurchase(99.99)}
  >
    {params['checkout.ctaText']}
  </button>
{:else}
  <button disabled>Loading...</button>
{/if}
```

## SSR with SvelteKit

For optimal performance and to prevent content flashing, fetch the config bundle on the server.

### Option A: Singleton Server Client (Recommended)

For production apps, use a singleton server client with caching, background refresh, and event tracking:

```typescript
// src/hooks.server.ts
import { createTrafficalClient } from '@traffical/svelte/server';
import { TRAFFICAL_API_KEY } from '$env/static/private';

// Singleton client with ETag caching, background refresh, and event batching
const traffical = await createTrafficalClient({
  orgId: 'org_123',
  projectId: 'proj_456',
  env: 'production',
  apiKey: TRAFFICAL_API_KEY,
});

export const handle = async ({ event, resolve }) => {
  event.locals.traffical = traffical;
  return resolve(event);
};
```

Then use it in your load functions:

```typescript
// src/routes/+layout.server.ts
export async function load({ locals }) {
  return {
    traffical: { bundle: locals.traffical.getBundle() },
  };
}
```

```typescript
// src/routes/checkout/+page.server.ts
export async function load({ locals, cookies }) {
  const userId = cookies.get('userId') || 'anonymous';

  // Full decision with tracking
  const decision = locals.traffical.decide({
    context: { userId },
    defaults: {
      'checkout.ctaText': 'Buy Now',
      'checkout.ctaColor': '#000000',
    },
  });

  return {
    checkoutParams: decision.values,
  };
}
```

Track events from API routes:

```typescript
// src/routes/api/purchase/+server.ts
export async function POST({ locals, request }) {
  const { orderId, amount } = await request.json();

  locals.traffical.track('purchase', { value: amount, orderId });

  return new Response('OK');
}
```

Don't forget to type `event.locals` in `app.d.ts`:

```typescript
// src/app.d.ts
import type { TrafficalClient } from '@traffical/svelte/server';

declare global {
  namespace App {
    interface Locals {
      traffical: TrafficalClient;
    }
  }
}

export {};
```

### Option B: Simple Load Function

For simpler apps, fetch the bundle per-request using SvelteKit's fetch:

```typescript
// src/routes/+layout.server.ts
import { loadTrafficalBundle } from '@traffical/svelte/sveltekit';
import { TRAFFICAL_API_KEY } from '$env/static/private';

export async function load({ fetch }) {
  const { bundle, error } = await loadTrafficalBundle({
    orgId: 'org_123',
    projectId: 'proj_456',
    env: 'production',
    apiKey: TRAFFICAL_API_KEY,
    fetch,
  });

  if (error) {
    console.warn('[Traffical] Failed to load config:', error);
  }

  return {
    traffical: { bundle },
  };
}
```

### Pre-resolve Parameters (Optional)

For pages where you need resolved values during SSR:

```typescript
// src/routes/checkout/+page.server.ts
import { loadTrafficalBundle, resolveParamsSSR } from '@traffical/svelte/sveltekit';
import { TRAFFICAL_API_KEY } from '$env/static/private';

export async function load({ fetch, cookies }) {
  const { bundle } = await loadTrafficalBundle({
    orgId: 'org_123',
    projectId: 'proj_456',
    env: 'production',
    apiKey: TRAFFICAL_API_KEY,
    fetch,
  });

  // Get user context from cookies/session
  const userId = cookies.get('userId') || 'anonymous';

  // Pre-resolve params for this page
  const checkoutParams = resolveParamsSSR(
    bundle,
    { userId },
    {
      'checkout.ctaText': 'Buy Now',
      'checkout.ctaColor': '#000000',
    }
  );

  return {
    traffical: { bundle },
    checkoutParams,
  };
}
```

## API Reference

### Provider

#### `<TrafficalProvider>`

Wrapper component that initializes Traffical context.

```svelte
<TrafficalProvider config={...}>
  <slot />
</TrafficalProvider>
```

#### `initTraffical(config)`

Function-based alternative to the Provider component.

```svelte
<script>
  import { initTraffical } from '@traffical/svelte';

  initTraffical({
    orgId: 'org_123',
    projectId: 'proj_456',
    env: 'production',
    apiKey: 'pk_...',
  });
</script>
```

### Hooks

#### `useTraffical(options)`

Primary hook for parameter resolution and decision tracking.

```typescript
const { params, ready, decision, error, trackExposure, track } = useTraffical({
  defaults: { 'feature.name': 'default-value' },
  context: { customField: 'value' }, // Optional
  tracking: 'full', // 'full' | 'decision' | 'none'
});
```

**Tracking Modes:**
- `'full'` (default) - Track decision + automatic exposure
- `'decision'` - Track decision only, manual exposure control
- `'none'` - No tracking (for SSR, tests, or internal logic)

**Return Value:**
- `params` - Resolved parameter values (reactive)
- `decision` - Decision metadata (null when `tracking="none"`)
- `ready` - Whether the client is ready
- `error` - Any initialization error
- `trackExposure` - Manually track exposure (no-op when `tracking="none"`)
- `track` - Track event with bound decisionId (no-op when `tracking="none"`)

#### `useTrafficalTrack()`

Returns a function to track user events.

> **Tip:** For most use cases, use the bound `track` from `useTraffical()` instead. It automatically includes the `decisionId`. Use this standalone hook for advanced scenarios like cross-component event tracking.

```typescript
// Recommended: use bound track from useTraffical
const { params, track } = useTraffical({
  defaults: { 'checkout.ctaText': 'Buy Now' },
});
track('purchase', { value: 99.99, orderId: 'ord_123' });

// Advanced: standalone hook when you need to attribute to a specific decision
const standaloneTrack = useTrafficalTrack();
standaloneTrack({
  event: 'purchase',
  properties: { value: 99.99 },
  decisionId: someOtherDecision.decisionId,
});
```

#### `useTrafficalReward()` (deprecated)

> **Deprecated:** Use `useTrafficalTrack()` instead.

#### `useTrafficalClient()`

Access the underlying Traffical client directly.

```typescript
const { client, ready, error } = useTrafficalClient();

if (client) {
  const version = client.getConfigVersion();
  const stableId = client.getStableId();
}
```

#### `useTrafficalPlugin(name)`

Access a registered plugin by name.

```typescript
import type { DOMBindingPlugin } from '@traffical/js-client';

const domPlugin = useTrafficalPlugin<DOMBindingPlugin>('dom-binding');
domPlugin?.applyBindings();
```

### Server-Side Utilities

Import from `@traffical/svelte/server` for full server-side support:

#### `createTrafficalClient(options)`

Create a singleton server client with caching, background refresh, and event tracking.

```typescript
import { createTrafficalClient } from '@traffical/svelte/server';

const traffical = await createTrafficalClient({
  orgId: 'org_123',
  projectId: 'proj_456',
  env: 'production',
  apiKey: 'sk_...',
});

// Make decisions with tracking
const decision = traffical.decide({
  context: { userId: 'user_123' },
  defaults: { 'feature.enabled': false },
});

// Track events
traffical.track('purchase', { value: 99.99 });

// Clean up on shutdown
await traffical.destroy();
```

#### `loadTrafficalBundle(options)`

Fetch the config bundle in a SvelteKit load function (simpler alternative).

```typescript
import { loadTrafficalBundle } from '@traffical/svelte/server';
// or: import { loadTrafficalBundle } from '@traffical/svelte/sveltekit';

const { bundle, error } = await loadTrafficalBundle({
  orgId: 'org_123',
  projectId: 'proj_456',
  env: 'production',
  apiKey: 'pk_...',
  fetch, // SvelteKit's fetch
});
```

#### `resolveParamsSSR(bundle, context, defaults)`

Resolve parameters on the server for SSR.

```typescript
import { resolveParamsSSR } from '@traffical/svelte/server';

const params = resolveParamsSSR(bundle, { userId: 'user_123' }, {
  'feature.name': 'default',
});
```

## Configuration Options

```typescript
interface TrafficalProviderConfig {
  // Required
  orgId: string;
  projectId: string;
  env: string;
  apiKey: string;

  // Optional - Connection
  baseUrl?: string;
  localConfig?: ConfigBundle;
  refreshIntervalMs?: number; // Default: 60000

  // Optional - Identity
  unitKeyFn?: () => string;
  contextFn?: () => Context;

  // Optional - Tracking
  trackDecisions?: boolean; // Default: true
  decisionDeduplicationTtlMs?: number; // Default: 1 hour
  exposureSessionTtlMs?: number; // Default: 30 minutes

  // Optional - Plugins
  plugins?: TrafficalPlugin[];

  // Optional - Event Batching
  eventBatchSize?: number; // Default: 10
  eventFlushIntervalMs?: number; // Default: 30000

  // Optional - SSR
  initialBundle?: ConfigBundle | null;
  initialParams?: Record<string, unknown>;
}
```

## TypeScript

The SDK is fully typed. Use generics for type-safe parameter access:

```typescript
interface CheckoutParams {
  'checkout.ctaText': string;
  'checkout.ctaColor': string;
  'checkout.showDiscount': boolean;
}

const { params } = useTraffical<CheckoutParams>({
  defaults: {
    'checkout.ctaText': 'Buy Now',
    'checkout.ctaColor': '#000000',
    'checkout.showDiscount': false,
  },
});

// params['checkout.ctaText'] is typed as string
// params['checkout.showDiscount'] is typed as boolean
```

## Comparison with React SDK

| Feature | React | Svelte |
|---------|-------|--------|
| Provider | `<TrafficalProvider>` | `<TrafficalProvider>` |
| Main hook | `useTraffical()` | `useTraffical()` |
| Bound event tracking | `track` from `useTraffical()` | `track` from `useTraffical()` |
| Standalone track hook | `useTrafficalTrack()` | `useTrafficalTrack()` |
| Client access | `useTrafficalClient()` | `useTrafficalClient()` |
| Plugin access | `useTrafficalPlugin()` | `useTrafficalPlugin()` |
| Reactivity | `useState`/`useEffect` | `$state`/`$derived` |
| SSR | `initialParams` prop | `loadTrafficalBundle()` helper |

## License

MIT

