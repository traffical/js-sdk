# Traffical JavaScript SDK

Official JavaScript/TypeScript SDKs for [Traffical](https://traffical.io) - the experimentation platform.

## Packages

| Package | Description | npm |
|---------|-------------|-----|
| [@traffical/core](packages/core) | Pure TypeScript core - parameter resolution without I/O | [![npm](https://img.shields.io/npm/v/@traffical/core)](https://www.npmjs.com/package/@traffical/core) |
| [@traffical/js-client](packages/js-client) | Browser client with caching and event tracking | [![npm](https://img.shields.io/npm/v/@traffical/js-client)](https://www.npmjs.com/package/@traffical/js-client) |
| [@traffical/react](packages/react) | React provider and hooks | [![npm](https://img.shields.io/npm/v/@traffical/react)](https://www.npmjs.com/package/@traffical/react) |
| [@traffical/svelte](packages/svelte) | Svelte 5 bindings with SSR support | [![npm](https://img.shields.io/npm/v/@traffical/svelte)](https://www.npmjs.com/package/@traffical/svelte) |
| [@traffical/node](packages/node) | Node.js server SDK | [![npm](https://img.shields.io/npm/v/@traffical/node)](https://www.npmjs.com/package/@traffical/node) |
| [@traffical/cli](packages/cli) | Command-line interface for config-as-code | [![npm](https://img.shields.io/npm/v/@traffical/cli)](https://www.npmjs.com/package/@traffical/cli) |

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
      apiKey="pk_..."
      context={{ userId: 'user-123' }}
    >
      <MyComponent />
    </TrafficalProvider>
  );
}

function MyComponent() {
  const { params, ready } = useTraffical();
  
  if (!ready) return <div>Loading...</div>;
  
  return (
    <button style={{ color: params['button.color'] }}>
      {params['button.text']}
    </button>
  );
}
```

### Svelte

```bash
npm install @traffical/svelte
```

```svelte
<script>
  import { TrafficalProvider, useTraffical } from '@traffical/svelte';
  
  const traffical = useTraffical();
</script>

<TrafficalProvider
  apiKey="pk_..."
  context={{ userId: 'user-123' }}
>
  {#if $traffical.ready}
    <button style:color={$traffical.params['button.color']}>
      {$traffical.params['button.text']}
    </button>
  {/if}
</TrafficalProvider>
```

### Node.js

```bash
npm install @traffical/node
```

```typescript
import { TrafficalClient } from '@traffical/node';

const client = new TrafficalClient({
  apiKey: 'sk_...',
});

const decision = await client.decide({ userId: 'user-123' });
console.log(decision.params);
```

## Versioning

All packages follow [Semantic Versioning](https://semver.org/).

**Current versions** (as of initial npm publish):

| Package | Version |
|---------|---------|
| @traffical/core | 0.1.2 |
| @traffical/js-client | 0.1.2 |
| @traffical/react | 0.1.1 |
| @traffical/svelte | 0.1.0 |
| @traffical/node | 0.1.2 |
| @traffical/cli | 0.1.0 |

**0.x versions**: API may change between minor versions. Check changelogs before upgrading.

**1.0 and beyond**: Breaking changes only in major versions.

We use [Changesets](https://github.com/changesets/changesets) for version management.
When contributing, run `bunx changeset` to document your changes.

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

