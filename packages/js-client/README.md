# @traffical/js-client

JavaScript SDK for browser environments with error boundaries, exposure deduplication, and smart event batching.

## Installation

### NPM

```bash
npm install @traffical/js-client
# or
bun add @traffical/js-client
```

### CDN

```html
<script src="https://cdn.traffical.io/js-client/v1/traffical.min.js"></script>
```

## Usage

### NPM / ES Modules

```typescript
import { createTrafficalClient } from '@traffical/js-client';

const traffical = await createTrafficalClient({
  orgId: 'org_xxx',
  projectId: 'proj_xxx',
  env: 'production',
  apiKey: 'pk_xxx',
});

// Get parameters
const params = traffical.getParams({
  context: { userId: 'user_123' },
  defaults: {
    'ui.hero.title': 'Welcome',
    'ui.hero.color': '#000',
  },
});

// Make decision with tracking metadata
const decision = traffical.decide({
  context: { userId: 'user_123' },
  defaults: { 'ui.hero.title': 'Welcome' },
});

// Track exposure (automatically deduplicated)
traffical.trackExposure(decision);

// Track user events
traffical.track('purchase', { value: 99.99, orderId: 'ord_123' });
traffical.track('add_to_cart', { itemId: 'sku_456' });

// Track with explicit decision attribution
traffical.track('checkout_complete', { value: 1 }, { decisionId: decision.decisionId });
```

### CDN / Script Tag

```html
<script src="https://cdn.traffical.io/js-client/v1/traffical.min.js"></script>
<script>
  Traffical.init({
    orgId: 'org_xxx',
    projectId: 'proj_xxx',
    env: 'production',
    apiKey: 'pk_xxx',
  }).then(function(traffical) {
    var params = traffical.getParams({
      context: { userId: 'user_123' },
      defaults: { 'ui.hero.title': 'Welcome' },
    });
    console.log(params);
  });
</script>
```

### Google Tag Manager

```html
<script>
  (function() {
    var s = document.createElement('script');
    s.src = 'https://cdn.traffical.io/js-client/v1/traffical.min.js';
    s.onload = function() {
      Traffical.init({
        orgId: '{{Traffical Org ID}}',
        projectId: '{{Traffical Project ID}}',
        env: '{{Traffical Environment}}',
        apiKey: '{{Traffical API Key}}',
      });
    };
    document.head.appendChild(s);
  })();
</script>
```

## Configuration Options

```typescript
createTrafficalClient({
  // Required
  orgId: string,
  projectId: string,
  env: string,
  apiKey: string,
  
  // Optional
  baseUrl?: string,                // Default: https://sdk.traffical.io
  refreshIntervalMs?: number,      // Config refresh interval (default: 60000)
  localConfig?: ConfigBundle,      // Offline fallback config
  eventBatchSize?: number,         // Events per batch (default: 10)
  eventFlushIntervalMs?: number,   // Flush interval (default: 30000)
  exposureSessionTtlMs?: number,   // Dedup session TTL (default: 1800000)
  plugins?: TrafficalPlugin[],     // Plugins to register
});
```

## Features

- **Error Boundary** - SDK errors never crash your app
- **Exposure Deduplication** - Same user/variant = 1 exposure per session
- **Smart Batching** - Events batched and flushed efficiently
- **Beacon on Unload** - Events sent reliably on page close
- **Auto Stable ID** - Anonymous user identification via localStorage/cookie
- **Plugin System** - Extensible via plugins
- **DOM Binding Plugin** - Auto-apply parameters to DOM elements

## Plugins

### DOM Binding Plugin

Automatically applies parameter values to DOM elements based on bindings configured via the Traffical Visual Editor.

```typescript
import { createTrafficalClient, createDOMBindingPlugin } from '@traffical/js-client';

const traffical = await createTrafficalClient({
  orgId: 'org_xxx',
  projectId: 'proj_xxx',
  env: 'production',
  apiKey: 'pk_xxx',
  plugins: [
    createDOMBindingPlugin({
      observeMutations: true,  // Watch for DOM changes (SPA support)
      debounceMs: 100,         // Debounce reapplication
    }),
  ],
});

// Parameters are automatically applied to DOM elements
// when getParams() or decide() is called
const params = traffical.getParams({
  context: { userId: 'user_123' },
  defaults: { 'hero.headline': 'Welcome' },
});

// Access the plugin for manual control
const bindingPlugin = traffical.getPlugin('dom-binding');
bindingPlugin?.applyBindings();  // Re-apply bindings
bindingPlugin?.getBindings();    // Get current bindings
```

The plugin:
- Receives bindings from the config bundle via `onConfigUpdate`
- Applies parameter values to DOM elements via `onResolve` and `onDecision`
- Supports URL pattern matching (regex) for page-specific bindings
- Uses MutationObserver for SPA support
- Supports multiple property types: `innerHTML`, `textContent`, `src`, `href`, `style.*`

## Development

### Build

```bash
# Install dependencies (from sdk/ root)
cd ../
bun install

# Build ESM + IIFE
cd js-client
bun run build

# Type check only
bun run typecheck
```

### Output

| File | Format | Use Case |
|------|--------|----------|
| `dist/index.js` | ESM | npm / bundlers |
| `dist/traffical.min.js` | IIFE | CDN / script tag |

### Release to CDN

```bash
# Requires wrangler CLI with R2 access configured
./scripts/release-cdn.sh
```

This uploads to:
- `cdn.traffical.io/js-client/v{VERSION}/` - Immutable, 1 year cache
- `cdn.traffical.io/js-client/v{MAJOR}/` - Latest major, 1 hour cache
- `cdn.traffical.io/js-client/latest/` - Latest, 5 minute cache

