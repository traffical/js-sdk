# Traffical JavaScript SDK

Official JavaScript/TypeScript SDKs for [Traffical](https://traffical.io).

Traffical is a production-grade platform for experimentation, feature management, and adaptive optimization. It unifies A/B testing, feature flags, and contextual bandits into a single parameter-first system. These SDKs resolve parameters locally at the edge with sub-millisecond latency—no per-request API calls required.

## Packages

| Package | Description | npm |
|---------|-------------|-----|
| [@traffical/core](packages/core) | Pure TypeScript core — parameter resolution, contextual bandit scoring | [![npm](https://img.shields.io/npm/v/@traffical/core)](https://www.npmjs.com/package/@traffical/core) |
| [@traffical/js-client](packages/js-client) | Browser client with caching, event tracking, plugins | [![npm](https://img.shields.io/npm/v/@traffical/js-client)](https://www.npmjs.com/package/@traffical/js-client) |
| [@traffical/react](packages/react) | React provider and hooks | [![npm](https://img.shields.io/npm/v/@traffical/react)](https://www.npmjs.com/package/@traffical/react) |
| [@traffical/react-native](packages/react-native) | React Native with AsyncStorage & AppState | [![npm](https://img.shields.io/npm/v/@traffical/react-native)](https://www.npmjs.com/package/@traffical/react-native) |
| [@traffical/svelte](packages/svelte) | Svelte 5 bindings with SSR support | [![npm](https://img.shields.io/npm/v/@traffical/svelte)](https://www.npmjs.com/package/@traffical/svelte) |
| [@traffical/node](packages/node) | Node.js server SDK | [![npm](https://img.shields.io/npm/v/@traffical/node)](https://www.npmjs.com/package/@traffical/node) |

See also: [@traffical/cli](https://github.com/traffical/cli) — Command-line interface for config-as-code (separate repository)

## Quick Start

### React

```bash
npm install @traffical/react
```

```tsx
import { TrafficalProvider, useTraffical } from '@traffical/react';

function App() {
  return (
    <TrafficalProvider
      config={{
        orgId: 'org_123',
        projectId: 'proj_456',
        env: 'production',
        apiKey: 'pk_...',
      }}
    >
      <MyComponent />
    </TrafficalProvider>
  );
}

function MyComponent() {
  const { params, ready } = useTraffical({
    defaults: { 'button.text': 'Buy Now', 'button.color': '#000000' },
  });

  if (!ready) return <div>Loading...</div>;

  return (
    <button style={{ color: params['button.color'] }}>
      {params['button.text']}
    </button>
  );
}
```

### React Native

```bash
npm install @traffical/react-native @react-native-async-storage/async-storage
```

```tsx
import { TrafficalRNProvider, useTraffical } from '@traffical/react-native';
import { ActivityIndicator } from 'react-native';

function App() {
  return (
    <TrafficalRNProvider
      config={{
        orgId: 'org_123',
        projectId: 'proj_456',
        env: 'production',
        apiKey: 'pk_...',
      }}
      loadingComponent={<ActivityIndicator />}
    >
      <MyScreen />
    </TrafficalRNProvider>
  );
}

function MyScreen() {
  const { params, track } = useTraffical({
    defaults: {
      'onboarding.ctaText': 'Get Started',
      'onboarding.showSkip': true,
    },
  });

  return (
    <Button
      title={params['onboarding.ctaText']}
      onPress={() => track('cta_tap')}
    />
  );
}
```

### Svelte

```bash
npm install @traffical/svelte
```

Initialize the client once at the root of your app:

```svelte
<!-- src/routes/+layout.svelte -->
<script>
  import { initTraffical } from '@traffical/svelte';

  let { children } = $props();

  initTraffical({
    orgId: 'org_123',
    projectId: 'proj_456',
    env: 'production',
    apiKey: 'pk_...',
  });
</script>

{@render children()}
```

Then resolve params in any child component:

```svelte
<!-- Button.svelte -->
<script>
  import { useTraffical } from '@traffical/svelte';

  // `params` is a reactive proxy — safe to destructure. Access `ready`
  // through the returned object (e.g. `t.ready`) to stay reactive.
  const t = useTraffical({
    defaults: { 'button.text': 'Buy Now', 'button.color': '#000000' },
  });
</script>

{#if t.ready}
  <button style:color={t.params['button.color']}>
    {t.params['button.text']}
  </button>
{/if}
```

### Node.js

```bash
npm install @traffical/node
```

```typescript
import { createTrafficalClient } from '@traffical/node';

const client = await createTrafficalClient({
  orgId: 'org_123',
  projectId: 'proj_456',
  env: 'production',
  apiKey: process.env.TRAFFICAL_API_KEY!,
});

// decide(context, defaults) — context first (spec 0.7.0 contract).
const decision = client.decide(
  { userId: 'user-123' },
  { 'button.text': 'Buy Now' }
);
console.log(decision.assignments);
```

## Key Features

### Contextual Bandit Scoring

The SDK scores contextual bandit policies locally using linear models embedded in config bundles. No server round-trip needed — the model runs softmax scoring with probability floors directly in the SDK.

```typescript
// Contextual bandits work transparently — the SDK automatically
// uses the embedded model when a policy has contextualModel set
const { params } = useTraffical({
  defaults: { 'recommendation.layout': 'grid' },
});
```

### Server-Evaluated Mode

For environments where bundle-based resolution isn't ideal, the SDK supports server-evaluated mode that sends context to the Edge Worker's `/v1/resolve` endpoint:

```typescript
const client = createTrafficalClient({
  apiKey: 'pk_...',
  evaluationMode: 'server', // default: 'bundle'
});
```

React Native uses server-evaluated mode by default and re-resolves decisions on identity changes.

### Warehouse-Native Assignment Logging

For teams with their own data warehouse, the SDK can log experiment assignments to your analytics pipeline for warehouse-native metric computation:

```typescript
import { createWarehouseNativeLoggerPlugin } from '@traffical/js-client';

const logger = createWarehouseNativeLoggerPlugin({
  type: 'segment',      // or 'rudderstack', 'custom'
  analytics: window.analytics,
});

const client = createTrafficalClient({
  apiKey: 'pk_...',
  assignmentLogger: logger,
});
```

Each log entry includes `policyKey`, `allocationKey`, `unitKey`, and timestamps — designed for joins in your data warehouse. Deduplication is available via `deduplicateAssignmentLogger`.

### Mid-Session Identity Changes

Update user identity mid-session (e.g., after login) and re-resolve all parameters:

```typescript
client.identify('user_789');
```

### Debug Plugin & DevTools

The debug plugin exposes SDK state via `window.__TRAFFICAL_DEBUG__` for consumption by the Traffical DevTools bookmarklet:

```typescript
import { createDebugPlugin } from '@traffical/js-client';

const client = createTrafficalClient({
  apiKey: 'pk_...',
  plugins: [createDebugPlugin()],
});
```

Supports multi-instance debugging, event streaming, unit key changes, re-decide, and parameter overrides.

### Parameter Overrides

Apply parameter overrides for testing or DevTools integration:

```typescript
client.applyOverrides({ 'button.color': 'red' });
client.clearOverrides();
client.onOverridesChange((overrides) => { /* react to changes */ });
```

### Redirect Experiments

URL split testing and redirect experiments with cookie-based attribution:

```typescript
import { createRedirectPlugin } from '@traffical/js-client';

const client = createTrafficalClient({
  apiKey: 'pk_...',
  plugins: [createRedirectPlugin()],
});
```

### Plugin Architecture

Extend SDK behavior with plugins — attach at init or late via `client.use()`:

```typescript
const client = createTrafficalClient({ apiKey: 'pk_...' });

// Late plugin attachment
client.use(createDebugPlugin());
```

Global instance discovery via `window.__TRAFFICAL_INSTANCES__` enables DevTools and external tools to attach to any running client.

## Versioning

All packages follow [Semantic Versioning](https://semver.org/).

**0.x versions**: API may change between minor versions. Check changelogs before upgrading.

**1.0 and beyond**: Breaking changes only in major versions.

We use [Changesets](https://github.com/changesets/changesets) for version management. When contributing, run `bunx changeset` to document your changes.

## Development

```bash
# Install dependencies
bun install

# Build all packages
bun run build

# Run tests
bun run test

# Type check
bun run typecheck
```

## License

MIT - see [LICENSE](LICENSE) for details.
