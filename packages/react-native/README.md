# @traffical/react-native

React Native SDK for Traffical - a unified parameter decisioning platform for feature flags, A/B testing, and contextual bandits.

Server-evaluated by default. Parameters are resolved on Traffical's edge, cached to AsyncStorage, and refreshed automatically when the app returns to the foreground.

## Installation

```bash
bun add @traffical/react-native @react-native-async-storage/async-storage
# or
npm install @traffical/react-native @react-native-async-storage/async-storage
```

`@react-native-async-storage/async-storage` is a required peer dependency for persistent caching.

## Quick Start

### 1. Wrap your app with TrafficalRNProvider

```tsx
import { TrafficalRNProvider } from '@traffical/react-native';
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
      loadingComponent={<ActivityIndicator size="large" />}
    >
      <Navigation />
    </TrafficalRNProvider>
  );
}
```

### 2. Use the `useTraffical` hook in your screens

```tsx
import { useTraffical } from '@traffical/react-native';

function OnboardingScreen() {
  const { params, ready, track } = useTraffical({
    defaults: {
      'onboarding.ctaText': 'Get Started',
      'onboarding.showSkip': true,
      'onboarding.accentColor': '#3b82f6',
    },
  });

  const handleCTATap = () => {
    track('onboarding_cta_tap');
  };

  return (
    <View>
      <Button
        title={params['onboarding.ctaText']}
        color={params['onboarding.accentColor']}
        onPress={handleCTATap}
      />
      {params['onboarding.showSkip'] && (
        <TouchableOpacity onPress={skipOnboarding}>
          <Text>Skip</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
```

## API Reference

### TrafficalRNProvider

Initializes the Traffical client with React Native defaults and provides it to child components.

```tsx
<TrafficalRNProvider
  config={config}
  loadingComponent={<ActivityIndicator />}
>
  {children}
</TrafficalRNProvider>
```

#### Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `config.orgId` | `string` | Yes | Organization ID |
| `config.projectId` | `string` | Yes | Project ID |
| `config.env` | `string` | Yes | Environment (e.g., "production", "staging") |
| `config.apiKey` | `string` | Yes | API key for authentication |
| `config.baseUrl` | `string` | No | Base URL for the control plane API |
| `config.evaluationMode` | `"server" \| "bundle"` | No | Resolution mode (default: `"server"`) |
| `config.refreshIntervalMs` | `number` | No | Background refresh interval (default: 60000) |
| `config.unitKeyFn` | `() => string` | No | Function to get the unit key. If not provided, uses automatic stable ID |
| `config.contextFn` | `() => Context` | No | Function to get additional context |
| `config.deviceInfoProvider` | `DeviceInfoProvider` | No | Provider for device metadata (OS, model, etc.) |
| `config.cacheMaxAgeMs` | `number` | No | Cache TTL for persisted responses (default: 24 hours) |
| `config.trackDecisions` | `boolean` | No | Whether to track decision events (default: true) |
| `config.decisionDeduplicationTtlMs` | `number` | No | Decision dedup TTL (default: 1 hour) |
| `config.exposureSessionTtlMs` | `number` | No | Exposure dedup session TTL (default: 30 min) |
| `config.plugins` | `TrafficalPlugin[]` | No | Additional plugins to register |
| `config.eventBatchSize` | `number` | No | Max events before auto-flush (default: 10) |
| `config.eventFlushIntervalMs` | `number` | No | Auto-flush interval (default: 30000) |
| `config.initialParams` | `Record<string, unknown>` | No | Initial params for fallback |
| `config.localConfig` | `ConfigBundle` | No | Local config bundle for offline fallback |
| `loadingComponent` | `ReactNode` | No | Shown while the SDK is initializing |

---

### useTraffical

Primary hook for parameter resolution and decision tracking. Identical API to `@traffical/react`.

```tsx
const { params, decision, ready, error, trackExposure, track, flushEvents } = useTraffical(options);
```

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `defaults` | `T` | Required | Default parameter values |
| `context` | `Context` | `undefined` | Additional context to merge |
| `tracking` | `"full" \| "decision" \| "none"` | `"full"` | Tracking mode |

#### Tracking Modes

| Mode | Decision Event | Exposure Event | Use Case |
|------|----------------|----------------|----------|
| `"full"` | Yes | Auto | Default. UI shown to users |
| `"decision"` | Yes | Manual | Manual exposure control (e.g., screen visibility) |
| `"none"` | No | No | Internal logic, tests |

#### Return Value

| Property | Type | Description |
|----------|------|-------------|
| `params` | `T` | Resolved parameter values |
| `decision` | `DecisionResult \| null` | Decision metadata (null when `tracking="none"`) |
| `ready` | `boolean` | Whether the client is ready |
| `error` | `Error \| null` | Any initialization error |
| `trackExposure` | `() => void` | Manually track exposure |
| `track` | `(event: string, properties?: object) => void` | Track event with bound decisionId |
| `flushEvents` | `() => Promise<void>` | Flush all pending events immediately |

#### Examples

```tsx
// Full tracking (default) - decision + exposure events
const { params, track } = useTraffical({
  defaults: { 'checkout.ctaText': 'Buy Now' },
});

// Decision tracking only - manual exposure control
const { params, trackExposure } = useTraffical({
  defaults: { 'checkout.ctaText': 'Buy Now' },
  tracking: 'decision',
});

// No tracking - for tests or internal logic
const { params, ready } = useTraffical({
  defaults: { 'ui.theme': 'light' },
  tracking: 'none',
});
```

---

### useTrafficalTrack

Standalone hook for tracking events outside of a `useTraffical` decision.

```tsx
const track = useTrafficalTrack();

const handlePurchase = (amount: number) => {
  track('purchase', { value: amount, orderId: 'ord_123' });
};
```

> **Tip:** For most use cases, use the bound `track` from `useTraffical()` instead — it automatically includes the `decisionId`.

---

### useTrafficalClient

Hook to access the Traffical client directly.

```tsx
const { client, ready, error } = useTrafficalClient();

if (ready && client) {
  const version = client.getConfigVersion();
  const stableId = client.getStableId();
}
```

---

### useTrafficalPlugin

Hook to access a registered plugin by name.

```tsx
const myPlugin = useTrafficalPlugin<MyPlugin>('my-plugin');
```

---

## How It Works

### Initialization Flow

```
App Launch
│
├─ 1. AsyncStorage preload (all traffical:* keys → memory)
├─ 2. Load cached server response (if within cache TTL)
├─ 3. Mark ready with cached data (or show loadingComponent)
├─ 4. Fetch fresh response from edge (/v1/resolve)
└─ 5. Update params + persist to cache
```

### Foreground Resume

When the app returns from the background, the SDK checks whether enough time has elapsed since the last resolve (based on `suggestedRefreshMs` from the server, default 60s). If stale, it triggers a background refresh.

```
Background → Foreground
│
├─ Check: now - lastResolve >= suggestedRefreshMs?
│   ├─ Yes → refreshConfig() in background
│   └─ No  → do nothing
```

### Cache Priority

On cold start, the SDK uses this fallback chain:

| Priority | Source | Behavior |
|----------|--------|----------|
| 1 | Cached `ServerResolveResponse` (within TTL) | Ready immediately, background refresh |
| 2 | Cached response (expired) | Ready immediately, background refresh |
| 3 | No cache | Wait for server response, show `loadingComponent` |
| 4 | `localConfig` from options | Offline fallback |
| 5 | `initialParams` from options | Last-resort override |
| 6 | `defaults` from `useTraffical` | Absolute fallback |

---

## Use Cases

### Feature Flag

```tsx
function HomeScreen() {
  const { params } = useTraffical({
    defaults: { 'feature.newFeed': false },
  });

  return params['feature.newFeed'] ? <NewFeed /> : <ClassicFeed />;
}
```

### A/B Test with Conversion Tracking

```tsx
function PaywallScreen() {
  const { params, track } = useTraffical({
    defaults: {
      'paywall.headline': 'Go Premium',
      'paywall.showTrial': true,
      'paywall.accentColor': '#6366f1',
    },
  });

  const handleSubscribe = (plan: string, price: number) => {
    track('subscribe', { value: price, plan });
  };

  return (
    <View>
      <Text style={{ color: params['paywall.accentColor'] }}>
        {params['paywall.headline']}
      </Text>
      {params['paywall.showTrial'] && <TrialBanner />}
      <PlanPicker onSelect={handleSubscribe} />
    </View>
  );
}
```

### Flushing Events Before Navigation

```tsx
function CheckoutScreen({ navigation }) {
  const { params, track, flushEvents } = useTraffical({
    defaults: { 'checkout.ctaText': 'Complete Purchase' },
  });

  const handlePurchase = async (total: number) => {
    track('purchase', { value: total });
    await flushEvents();
    navigation.replace('Success');
  };

  return (
    <Button
      title={params['checkout.ctaText']}
      onPress={() => handlePurchase(99.99)}
    />
  );
}
```

---

## Differences from @traffical/react

| | `@traffical/react` | `@traffical/react-native` |
|---|---|---|
| **Default evaluation** | Bundle (client-side) | Server (edge-evaluated) |
| **Storage** | localStorage | AsyncStorage (preloaded to memory) |
| **Lifecycle** | `visibilitychange` / `pagehide` | `AppState` change |
| **Loading state** | Manual (`if (!ready)`) | Built-in `loadingComponent` prop |
| **Unload flush** | sendBeacon on page unload | Regular flush (no unload concept) |
| **DOM plugin** | Available | Not available (no DOM) |
| **Hook API** | `useTraffical`, `useTrafficalTrack`, etc. | Identical |

---

## Best Practices

### 1. Always Provide Sensible Defaults

Defaults are used when no experiment is running, the user doesn't match targeting, or the SDK is still loading.

```tsx
// ✅ Good: works without any experiment
const { params } = useTraffical({
  defaults: {
    'pricing.discount': 0,
    'ui.accentColor': '#3b82f6',
  },
});
```

### 2. Use the loadingComponent Prop

Unlike web apps where a blank flash is acceptable, mobile users expect immediate content. Use `loadingComponent` to show a spinner or skeleton until the first resolve completes.

```tsx
<TrafficalRNProvider
  config={config}
  loadingComponent={<SplashScreen />}
>
  <App />
</TrafficalRNProvider>
```

### 3. Track Events at Conversion Points

```tsx
const { params, track } = useTraffical({
  defaults: { 'checkout.showUpsells': false },
});

// Track meaningful conversions
const handlePurchase = (amount: number) => {
  track('purchase', { value: amount });
};

// Track micro-conversions too
const handleAddToCart = () => {
  track('add_to_cart', { itemId: 'sku_456' });
};
```

### 4. Use Consistent Parameter Naming

```
category.subcategory.name

feature.*     → Feature flags        (boolean)
ui.*          → Visual variations    (string, number)
pricing.*     → Pricing experiments  (number)
copy.*        → Copywriting tests    (string)
onboarding.*  → Onboarding flow      (mixed)
```

---

## License

MIT
