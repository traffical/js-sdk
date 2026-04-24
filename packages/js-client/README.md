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

## Changing User Identity

Use `identify()` to switch the user identity mid-session (e.g., after login). All framework providers (React, Svelte, React Native) automatically re-evaluate decisions and update the UI.

```typescript
// After user logs in
traffical.identify('user_logged_in_123');

// After logout — revert to anonymous
traffical.identify(crypto.randomUUID());
```

Unlike `setStableId()` (which silently changes the internal ID), `identify()` notifies all subscribers — framework providers re-render, the debug plugin updates, and DevTools reflects the change.

## Parameter Overrides (Plugin API)

The client supports runtime parameter overrides intended for debugging and DevTools integration. These methods are available on the client instance but are designed for plugin use (not general application code):

```typescript
// Apply overrides — only affects keys present in decide()/getParams() defaults
client.applyOverrides({ 'feature.enabled': true, 'feature.color': 'red' });

// Get current overrides
client.getOverrides(); // { 'feature.enabled': true, 'feature.color': 'red' }

// Clear all overrides
client.clearOverrides();

// Listen for override changes (used by framework providers for reactivity)
const unsub = client.onOverridesChange((overrides) => {
  console.log('Overrides changed:', overrides);
});
unsub(); // unsubscribe
```

Overrides are applied **post-resolution** in `decide()` and `getParams()`. They only affect keys that exist in the `defaults` object passed to those methods. Framework providers (React, Svelte, React Native) automatically re-evaluate when overrides change.

The Traffical DevTools debug plugin uses these methods to let developers force parameter values during development and QA.

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

### Redirect Plugin

Run URL split tests (redirect experiments) where visitors are redirected to different landing page variants. The redirect plugin automatically triggers a decision on init, performs the redirect, and sets an attribution cookie. The attribution plugin ensures conversions on the variant page are attributed back to the experiment.

```typescript
import {
  createTrafficalClient,
  createRedirectPlugin,
  createRedirectAttributionPlugin,
} from '@traffical/js-client';

const traffical = await createTrafficalClient({
  orgId: 'org_xxx',
  projectId: 'proj_xxx',
  env: 'production',
  apiKey: 'pk_xxx',
  plugins: [
    createRedirectPlugin(),
    createRedirectAttributionPlugin(),
  ],
});

// That's it — the redirect plugin calls decide() automatically on init.
// On entry pages, it redirects. On other pages, it's a no-op.

// Track goals as usual — the attribution plugin injects
// redirect experiment metadata into every track() call.
traffical.track('add_to_cart', { value: 29.99 });
```

#### GTM Integration

On **all pages**, add the Traffical SDK with both redirect plugins:

```html
<script src="https://cdn.traffical.io/js-client/v1/traffical.min.js"></script>
<script>
  Traffical.init({
    orgId: '{{Traffical Org ID}}',
    projectId: '{{Traffical Project ID}}',
    env: '{{Traffical Environment}}',
    apiKey: '{{Traffical API Key}}',
    plugins: [
      Traffical.createRedirectPlugin(),
      Traffical.createRedirectAttributionPlugin(),
    ],
  });
</script>
```

Track goal events from a separate GTM tag (e.g., triggered on "Add to Cart" click):

```html
<script>
  var client = Traffical.instance();
  if (client) {
    client.track('add_to_cart', { value: 29.99 });
  }
</script>
```

#### How It Works

1. **Init** — The redirect plugin's `onInitialize` hook receives the client and calls `decide()` automatically.

2. **Entry page** — `onBeforeDecision` injects `url.pathname` into the context. The policy condition (e.g., `url.pathname startsWith /products/pillow`) matches, `redirect.url` resolves to the variant URL. `onDecision` writes an attribution cookie (`traffical_rdr`) and calls `window.location.replace()`.

3. **Variant page** — The SDK loads again, `decide()` runs, but the policy condition doesn't match the new URL, so `redirect.url` stays empty and no redirect happens. The redirect-attribution plugin reads the `traffical_rdr` cookie and injects the experiment metadata into every `track()` call.

#### Configuration

```typescript
createRedirectPlugin({
  parameterKey?: string,   // Default: "redirect.url"
  compareMode?: string,    // "pathname" (default) or "href"
  cookieName?: string,     // Default: "traffical_rdr"
});

createRedirectAttributionPlugin({
  cookieName?: string,     // Default: "traffical_rdr"
  expiryMs?: number,       // Default: 86400000 (24 hours)
});
```

#### Context Fields

The redirect plugin automatically adds these context fields:

| Field | Value | Example |
|-------|-------|---------|
| `url.pathname` | `window.location.pathname` | `/products/pillow` |

Use `url.pathname` in policy conditions to target specific pages.

## Type-Safe Event Tracking

Use `@traffical/cli generate-types` to generate TypeScript interfaces for your event schemas. This lets you create a strictly typed `track` function that catches invalid event names and properties at compile time.

### 1. Generate types from your config

```bash
bunx @traffical/cli generate-types
# → creates .traffical/traffical.generated.ts
```

### 2. Create a typed track wrapper

```typescript
import type { TrafficalEventProperties } from './traffical.generated';
import { createTrafficalClient } from '@traffical/js-client';

type TypedTrack = <E extends Extract<keyof TrafficalEventProperties, string>>(
  event: E,
  properties?: TrafficalEventProperties[E],
  options?: { decisionId?: string; unitKey?: string }
) => void;

const client = await createTrafficalClient({ /* ... */ });

// Cast client.track to the strict type
export const track = client.track.bind(client) as unknown as TypedTrack;
```

### 3. Use it — invalid properties are caught at compile time

```typescript
track('purchase', {
  order_total: 99.99,
  payment_method: 'visa',
}); // ✅

track('purchase', {
  order_total: 99.99,
  random_field: true, // ❌ Type error
});

track('nonexistent_event'); // ❌ Type error
```

---

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

