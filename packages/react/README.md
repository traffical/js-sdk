# @traffical/react

React SDK for Traffical - a unified parameter decisioning platform for feature flags, A/B testing, and contextual bandits.

## Installation

```bash
bun add @traffical/react
# or
npm install @traffical/react
```

## Quick Start

### 1. Wrap your app with TrafficalProvider

```tsx
import { TrafficalProvider } from '@traffical/react';

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
```

### 2. Use the `useTraffical` hook in your components

```tsx
import { useTraffical } from '@traffical/react';

function MyComponent() {
  const { params, ready, track } = useTraffical({
    defaults: {
      'ui.hero.title': 'Welcome',
      'ui.hero.color': '#007bff',
    },
  });

  const handleCTAClick = () => {
    // Track a user event (decisionId is automatically bound)
    track('cta_click', { button: 'hero' });
  };

  if (!ready) return <div>Loading...</div>;

  return (
    <h1 style={{ color: params['ui.hero.color'] }} onClick={handleCTAClick}>
      {params['ui.hero.title']}
    </h1>
  );
}
```

## API Reference

### TrafficalProvider

Initializes the Traffical client and provides it to child components.

```tsx
<TrafficalProvider config={config}>
  {children}
</TrafficalProvider>
```

#### Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `config.orgId` | `string` | Yes | Organization ID |
| `config.projectId` | `string` | Yes | Project ID |
| `config.env` | `string` | Yes | Environment (e.g., "production", "staging") |
| `config.apiKey` | `string` | Yes | API key for authentication |
| `config.baseUrl` | `string` | No | Base URL for the control plane API |
| `config.localConfig` | `ConfigBundle` | No | Local config bundle for offline fallback |
| `config.refreshIntervalMs` | `number` | No | Config refresh interval (default: 60000) |
| `config.unitKeyFn` | `() => string` | No | Function to get the unit key (user ID). If not provided, uses automatic stable ID |
| `config.contextFn` | `() => Context` | No | Function to get additional context |
| `config.trackDecisions` | `boolean` | No | Whether to track decision events (default: true) |
| `config.decisionDeduplicationTtlMs` | `number` | No | Decision dedup TTL (default: 1 hour) |
| `config.exposureSessionTtlMs` | `number` | No | Exposure dedup session TTL (default: 30 min) |
| `config.plugins` | `TrafficalPlugin[]` | No | Additional plugins to register |
| `config.eventBatchSize` | `number` | No | Max events before auto-flush (default: 10) |
| `config.eventFlushIntervalMs` | `number` | No | Auto-flush interval (default: 30000) |
| `config.initialParams` | `Record<string, unknown>` | No | Initial params from SSR |

---

### useTraffical

Primary hook for parameter resolution and decision tracking.

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
| `"full"` | Yes | Auto | Default. UI components that users see |
| `"decision"` | Yes | Manual | Manual exposure control (e.g., viewport tracking) |
| `"none"` | No | No | SSR, tests, internal logic |

#### Return Value

| Property | Type | Description |
|----------|------|-------------|
| `params` | `T` | Resolved parameter values |
| `decision` | `DecisionResult \| null` | Decision metadata (null when `tracking="none"`) |
| `ready` | `boolean` | Whether the client is ready |
| `error` | `Error \| null` | Any initialization error |
| `trackExposure` | `() => void` | Manually track exposure (no-op when `tracking="none"`) |
| `track` | `(event: string, properties?: object) => void` | Track event with bound decisionId (no-op when `tracking="none"`) |
| `flushEvents` | `() => Promise<void>` | Flush all pending events immediately |

#### Examples

```tsx
// Full tracking (default) - decision + exposure events
const { params, decision, ready } = useTraffical({
  defaults: { 'checkout.ctaText': 'Buy Now' },
});

// Decision tracking only - manual exposure control
const { params, decision, trackExposure } = useTraffical({
  defaults: { 'checkout.ctaText': 'Buy Now' },
  tracking: 'decision',
});

// Track exposure when element is visible
useEffect(() => {
  if (isElementVisible && decision) {
    trackExposure();
  }
}, [isElementVisible, decision, trackExposure]);

// No tracking - for SSR, tests, or internal logic
const { params, ready } = useTraffical({
  defaults: { 'ui.hero.title': 'Welcome' },
  tracking: 'none',
});
```

---

### useTrafficalTrack

Hook to track user events for A/B testing and bandit optimization.

> **Tip:** For most use cases, use the bound `track` from `useTraffical()` instead. It automatically includes the `decisionId`. Use this standalone hook for advanced scenarios like cross-component event tracking or server-side tracking.

```tsx
// Recommended: use bound track from useTraffical
const { params, track } = useTraffical({
  defaults: { 'checkout.ctaText': 'Buy Now' },
});

const handlePurchase = (amount: number) => {
  track('purchase', { value: amount, orderId: 'ord_123' });
};

// Advanced: standalone hook when you need to attribute to a specific decision
const standaloneTrack = useTrafficalTrack();

standaloneTrack('purchase', { value: amount }, { decisionId: someOtherDecision.decisionId });
```

### useTrafficalReward (deprecated)

> **Deprecated:** Use `useTrafficalTrack()` instead.

Hook to track rewards for A/B testing and bandit optimization.

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
import { createDOMBindingPlugin, DOMBindingPlugin } from '@traffical/react';

// In your provider config:
// plugins: [createDOMBindingPlugin()]

// In a component:
const domPlugin = useTrafficalPlugin<DOMBindingPlugin>('dom-binding');

useEffect(() => {
  domPlugin?.applyBindings();
}, [contentLoaded, domPlugin]);
```

---

## Best Practices

# Traffical React SDK — Usage Patterns

## Mental Model

Traffical is **parameter-first**. You define parameters with defaults, and Traffical handles the rest—whether that's a static value, an A/B test, or an adaptive optimization. Your code doesn't need to know which.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Your Code                                                          │
│                                                                     │
│  1. Define parameters with defaults                                 │
│  2. Use the resolved values                                         │
│  3. Track rewards on conversion                                     │
└─────────────────────────────────────────────────────────────────────┘
                              ▲
                              │  (hidden from you)
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Traffical                                                          │
│                                                                     │
│  • Layers & policies for mutual exclusivity                         │
│  • Bucket assignment & deterministic hashing                        │
│  • Thompson Sampling & contextual bandits                           │
│  • Statistical analysis & optimization                              │
└─────────────────────────────────────────────────────────────────────┘
```

**Key insight:** Resolution is local and synchronous. The SDK fetches a config bundle once and caches it. Every `useTraffical()` call resolves instantly from cache—no network latency, no render flicker on page navigation.

---

## Quick Start

```tsx
import { useTraffical } from "@traffical/react";

function ProductPage() {
  const { params, track } = useTraffical({
    defaults: {
      "ui.cta.text": "Buy Now",
      "ui.cta.color": "#2563eb",
      "pricing.showDiscount": true,
    },
  });

  const handlePurchase = (amount: number) => {
    // track has the decisionId already bound!
    track("purchase", { value: amount, itemId: "prod_123" });
  };

  return (
    <button 
      style={{ backgroundColor: params["ui.cta.color"] }}
      onClick={() => handlePurchase(99.99)}
    >
      {params["ui.cta.text"]}
    </button>
  );
}
```

That's it. Default tracking is enabled automatically, and `track` knows which decision to attribute conversions to.

---

## API Reference

### `useTraffical(options)`

The primary hook for parameter resolution and experiment tracking.

```tsx
const { params, decision, ready, error, trackExposure, track } = useTraffical({
  defaults: { /* parameter defaults */ },
  context: { /* optional additional context */ },
  tracking: "full" | "decision" | "none",  // default: "full"
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `defaults` | `Record<string, ParameterValue>` | *required* | Default values for each parameter |
| `context` | `Record<string, unknown>` | `{}` | Additional context for targeting |
| `tracking` | `"full"` \| `"decision"` \| `"none"` | `"full"` | Controls event tracking behavior |

**Tracking Modes:**

| Mode | Decision Event | Exposure Event | Use Case |
|------|---------------|----------------|----------|
| `"full"` | ✅ Auto | ✅ Auto | UI shown to users (default) |
| `"decision"` | ✅ Auto | 🔧 Manual | Below-the-fold, lazy-loaded content |
| `"none"` | ❌ No | ❌ No | SSR, internal logic, tests |

---

## Use Cases

### 1. Feature Flag

Control feature rollout without redeploying.

```tsx
function Dashboard() {
  const { params } = useTraffical({
    defaults: {
      "feature.newAnalytics": false,
    },
  });

  if (params["feature.newAnalytics"]) {
    return <NewAnalyticsDashboard />;
  }
  return <LegacyDashboard />;
}
```

### 2. A/B Test with Conversion Tracking

Test different variants and measure which performs better.

```tsx
function PricingPage() {
  const { params, track } = useTraffical({
    defaults: {
      "pricing.headline": "Simple, transparent pricing",
      "pricing.showAnnualToggle": false,
      "pricing.highlightPlan": "pro",
    },
  });

  const handleSubscribe = (plan: string, amount: number) => {
    // decisionId is automatically bound
    track("subscription", { value: amount, plan });
  };

  return (
    <div>
      <h1>{params["pricing.headline"]}</h1>
      <PricingCards
        showAnnualToggle={params["pricing.showAnnualToggle"]}
        highlightPlan={params["pricing.highlightPlan"]}
        onSubscribe={handleSubscribe}
      />
    </div>
  );
}
```

### 3. Dynamic UI Configuration

Adjust colors, copy, and layout without code changes.

```tsx
function HeroBanner() {
  const { params } = useTraffical({
    defaults: {
      "ui.hero.title": "Welcome to Our Platform",
      "ui.hero.subtitle": "The best solution for your needs",
      "ui.hero.ctaText": "Get Started",
      "ui.hero.ctaColor": "#3b82f6",
      "ui.hero.layout": "centered",
    },
  });

  return (
    <section className={`hero-${params["ui.hero.layout"]}`}>
      <h1>{params["ui.hero.title"]}</h1>
      <p>{params["ui.hero.subtitle"]}</p>
      <button style={{ backgroundColor: params["ui.hero.ctaColor"] }}>
        {params["ui.hero.ctaText"]}
      </button>
    </section>
  );
}
```

### 4. Below-the-Fold Content (Manual Exposure)

Track exposure only when content is actually viewed.

```tsx
function ProductRecommendations() {
  const { params, trackExposure } = useTraffical({
    defaults: {
      "recommendations.algorithm": "collaborative",
      "recommendations.count": 4,
    },
    tracking: "decision",  // Decision tracked, exposure manual
  });

  const ref = useRef<HTMLDivElement>(null);

  // Track exposure when section scrolls into view
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          trackExposure();
          observer.disconnect();
        }
      },
      { threshold: 0.5 }
    );

    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [trackExposure]);

  return (
    <section ref={ref}>
      <RecommendationGrid
        algorithm={params["recommendations.algorithm"]}
        count={params["recommendations.count"]}
      />
    </section>
  );
}
```

### 5. Server-Side Rendering (No Tracking)

Use defaults during SSR, hydrate on client.

```tsx
// Server Component (Next.js App Router)
async function ProductPage({ productId }: { productId: string }) {
  // Server: use defaults directly (no SDK call)
  const defaultPrice = 299.99;

  return (
    <TrafficalProvider>
      <ProductDetails productId={productId} defaultPrice={defaultPrice} />
    </TrafficalProvider>
  );
}

// Client Component
"use client";
function ProductDetails({ productId, defaultPrice }: Props) {
  const { params, ready } = useTraffical({
    defaults: {
      "pricing.basePrice": defaultPrice,
      "pricing.discount": 0,
    },
  });

  // Shows defaultPrice immediately, updates when SDK ready
  const price = params["pricing.basePrice"] * (1 - params["pricing.discount"] / 100);

  return <Price value={price} loading={!ready} />;
}
```

### 6. Component with Self-Contained Parameters

Reusable component that owns its experiment surface.

```tsx
function CheckoutButton({ onCheckout }: { onCheckout: () => void }) {
  const { params } = useTraffical({
    defaults: {
      "checkout.button.text": "Complete Purchase",
      "checkout.button.color": "#22c55e",
      "checkout.button.showIcon": true,
    },
  });

  return (
    <button
      onClick={onCheckout}
      style={{ backgroundColor: params["checkout.button.color"] }}
    >
      {params["checkout.button.showIcon"] && <ShoppingCartIcon />}
      {params["checkout.button.text"]}
    </button>
  );
}
```

### 7. Multiple Event Types

Track different conversion events for the same decision.

```tsx
function CheckoutFlow() {
  const { params, track } = useTraffical({
    defaults: {
      "checkout.showExpressOption": true,
      "checkout.showUpsells": false,
    },
  });

  const handleAddUpsell = () => {
    track("upsell_accept", { upsellId: "premium" });
  };

  const handleComplete = (orderValue: number) => {
    track("checkout_complete", { value: orderValue });
  };

  return (
    <div>
      {params["checkout.showExpressOption"] && <ExpressCheckout />}
      {params["checkout.showUpsells"] && (
        <UpsellSection onAccept={handleAddUpsell} />
      )}
      <CheckoutForm onComplete={handleComplete} />
    </div>
  );
}
```

### 8. Flushing Events Before Navigation

Ensure critical conversion events are sent before page navigation.

```tsx
function CheckoutPage() {
  const router = useRouter();
  const { params, track, flushEvents } = useTraffical({
    defaults: {
      "checkout.ctaText": "Complete Purchase",
    },
  });

  const handlePurchase = async (total: number) => {
    // Track the purchase event
    track("purchase", { value: total, orderId: "ord_123" });
    
    // Flush events immediately to ensure they're sent before navigation
    await flushEvents();
    
    // Now safe to navigate away
    router.replace("/checkout/success");
  };

  return (
    <button onClick={() => handlePurchase(99.99)}>
      {params["checkout.ctaText"]}
    </button>
  );
}
```

---

## Architecture Patterns

### Pattern A: Page-Level Parameters (Recommended for Simple Pages)

All parameters defined at page level, passed as props to children.

```tsx
function ProductPage() {
  const { params, decision } = useTraffical({
    defaults: {
      "product.showReviews": true,
      "product.showRelated": true,
      "pricing.discount": 0,
      "ui.ctaColor": "#2563eb",
    },
  });

  return (
    <>
      <ProductDetails 
        showReviews={params["product.showReviews"]}
        ctaColor={params["ui.ctaColor"]}
      />
      <PricingSection discount={params["pricing.discount"]} />
      {params["product.showRelated"] && <RelatedProducts />}
    </>
  );
}
```

**Pros:** Single decision for attribution, clear data flow, testable components
**Cons:** Prop drilling, parent knows about all params

### Pattern B: Component-Level Parameters (Recommended for Reusable Components)

Each component owns its parameters.

```tsx
// ProductDetails owns its params
function ProductDetails() {
  const { params } = useTraffical({
    defaults: {
      "product.showReviews": true,
      "product.imageSize": "large",
    },
  });
  // ...
}

// PricingSection owns its params
function PricingSection() {
  const { params } = useTraffical({
    defaults: {
      "pricing.discount": 0,
      "pricing.showOriginal": true,
    },
  });
  // ...
}
```

**Pros:** Encapsulated, portable, self-documenting
**Cons:** Multiple decisions (handled via deduplication)

### Pattern C: Context + Pure Components (Recommended for Complex Pages)

Single decision distributed via context, pure components for rendering.

```tsx
// Context provider with all params
function ProductPageProvider({ children }) {
  const traffical = useTraffical({
    defaults: {
      "product.showReviews": true,
      "pricing.discount": 0,
      "ui.ctaColor": "#2563eb",
    },
  });

  return (
    <ProductPageContext.Provider value={traffical}>
      {children}
    </ProductPageContext.Provider>
  );
}

// Pure component, testable without Traffical
function PricingSection({ discount, showOriginal }: Props) {
  // Pure rendering logic
}

// Wrapper that connects to Traffical
function ConnectedPricingSection() {
  const { params } = useProductPageContext();
  return (
    <PricingSection
      discount={params["pricing.discount"]}
      showOriginal={params["pricing.showOriginal"]}
    />
  );
}
```

**Pros:** Single decision, no prop drilling, testable leaf components
**Cons:** More boilerplate

---

## Best Practices

### 1. Always Provide Sensible Defaults

Defaults are used when:
- No experiment is running
- User doesn't match targeting conditions
- SDK is still loading

```tsx
// ✅ Good: Works without any experiment
const { params } = useTraffical({
  defaults: {
    "pricing.discount": 0,
    "ui.buttonColor": "#3b82f6",
  },
});

// ❌ Bad: Undefined behavior without experiment
const { params } = useTraffical({
  defaults: {
    "pricing.discount": undefined,  // What does this mean?
  },
});
```

### 2. Group Related Parameters

Parameters that should vary together belong in the same `useTraffical()` call.

```tsx
// ✅ Good: Related params together
const { params } = useTraffical({
  defaults: {
    "pricing.basePrice": 299,
    "pricing.discount": 0,
    "pricing.showOriginal": true,
  },
});

// ⚠️ Caution: Separate calls = separate decisions
const pricing = useTraffical({ defaults: { "pricing.basePrice": 299 } });
const discount = useTraffical({ defaults: { "pricing.discount": 0 } });
```

### 3. Track Events at Conversion Points

Events enable Traffical to learn which variants perform best. Use the bound `track` from `useTraffical()` — it automatically includes the `decisionId`.

```tsx
const { params, track } = useTraffical({
  defaults: { "checkout.showUpsells": false },
});

// ✅ Track meaningful conversions
const handlePurchase = (amount: number) => {
  track("purchase", { value: amount, orderId: "ord_123" });
};

// ✅ Track micro-conversions too
const handleAddToCart = () => {
  track("add_to_cart", { itemId: "sku_456" });
};
```

### 4. Use Consistent Naming Conventions

```
category.subcategory.name

feature.*     → Feature flags        (boolean)
ui.*          → Visual variations    (string, number)
pricing.*     → Pricing experiments  (number)
copy.*        → Copywriting tests    (string)
experiment.*  → Explicit variants    (string)
```

### 5. Handle Loading State

```tsx
const { params, ready } = useTraffical({
  defaults: { "ui.heroVariant": "default" },
});

// Option A: Show defaults immediately (recommended)
// On page navigation, resolved values render immediately (no flicker)
return <Hero variant={params["ui.heroVariant"]} />;

// Option B: Show loading state (only for initial page load if needed)
if (!ready) return <HeroSkeleton />;
return <Hero variant={params["ui.heroVariant"]} />;
```

> **Note:** On client-side navigation (e.g., Next.js Link), params resolve synchronously—no loading state or flicker. Loading states are only relevant during the initial bundle fetch.

---

## Flicker-Free SSR (Next.js App Router)

The classic A/B testing problem: users briefly see the default content before it switches to their assigned variant. This section shows how to eliminate that flicker entirely.

### The Problem

Without special handling, here's what happens:
1. Server renders with defaults (no userId during SSR)
2. Client hydrates with defaults
3. SDK fetches config bundle
4. SDK resolves with userId → content changes (FLICKER!)

### The Solution: Cookie-Based SSR + LocalConfig

By passing the userId from server to client via cookies AND embedding the config bundle at build time, resolution can happen synchronously on both server and client.

#### Step 1: Middleware to Set UserId Cookie

```typescript
// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const COOKIE_NAME = 'traffical-userId';
const HEADER_NAME = 'x-traffical-userId';

function generateUserId(): string {
  const array = new Uint8Array(6);
  crypto.getRandomValues(array);
  return `user_${Array.from(array, b => b.toString(16).padStart(2, '0')).join('')}`;
}

export function middleware(request: NextRequest) {
  const existingUserId = request.cookies.get(COOKIE_NAME)?.value;
  const userId = existingUserId || generateUserId();
  
  // Pass userId via header for THIS request (cookie isn't available yet on first request)
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(HEADER_NAME, userId);
  
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  
  // Set cookie for NEXT request
  if (!existingUserId) {
    response.cookies.set(COOKIE_NAME, userId, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
      path: '/',
    });
  }
  
  return response;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*$).*)'],
};
```

#### Step 2: Server Layout Reads UserId

```tsx
// app/layout.tsx
import { cookies, headers } from 'next/headers';

export default async function RootLayout({ children }) {
  const headerStore = await headers();
  const cookieStore = await cookies();
  
  // Header for first request, cookie for subsequent
  const userId = headerStore.get('x-traffical-userId') || 
                 cookieStore.get('traffical-userId')?.value || '';

  return (
    <html>
      <body>
        <Providers initialUserId={userId}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
```

#### Step 3: Pass UserId Through Context

```tsx
// context/Providers.tsx
'use client';

export function Providers({ children, initialUserId }) {
  return (
    <DemoProvider initialUserId={initialUserId}>
      <TrafficalWrapper>
        {children}
      </TrafficalWrapper>
    </DemoProvider>
  );
}

// context/DemoContext.tsx
export function DemoProvider({ children, initialUserId }) {
  const [userId] = useState(initialUserId || '');
  
  // Use userId as initial state - NOT in useEffect
  // ...
}
```

#### Step 4: Provide LocalConfig to SDK

Fetch the config bundle at build time and pass it to the provider:

```typescript
// lib/traffical.ts
import configBundle from '@/data/config-bundle.json';

export const trafficalConfig = {
  orgId: process.env.NEXT_PUBLIC_TRAFFICAL_ORG_ID,
  projectId: process.env.NEXT_PUBLIC_TRAFFICAL_PROJECT_ID,
  apiKey: process.env.NEXT_PUBLIC_TRAFFICAL_API_KEY,
  // This is the key to flicker-free SSR!
  localConfig: configBundle as ConfigBundle,
};
```

#### Step 5: TrafficalWrapper Uses UserId

```tsx
// context/TrafficalWrapper.tsx
export function TrafficalWrapper({ children }) {
  const { userId } = useDemoContext();
  
  const config = useMemo(() => ({
    ...trafficalConfig,
    unitKeyFn: () => userId,  // Returns the server-provided userId
  }), [userId]);

  return (
    <TrafficalProvider config={config}>
      {children}
    </TrafficalProvider>
  );
}
```

### How It Works

```
Request Flow (First Visit):
─────────────────────────────────────────────────────────────────
1. Request arrives (no cookie)
2. Middleware generates userId → sets HEADER + COOKIE
3. Server layout reads userId from HEADER
4. Server passes userId to React via props
5. useTraffical's useState resolves from localConfig + userId
6. Server renders HTML with CORRECT variant
7. Response sent with Set-Cookie header
8. Client hydrates with SAME userId → NO FLICKER ✅
─────────────────────────────────────────────────────────────────

Subsequent Requests:
─────────────────────────────────────────────────────────────────
1. Request arrives WITH cookie
2. Middleware passes existing userId via header
3. Same flow as above → consistent experience
─────────────────────────────────────────────────────────────────
```

### Requirements

| Requirement | Why |
|-------------|-----|
| `localConfig` | Enables synchronous resolution without waiting for network |
| UserId in cookies | Server can read it during SSR |
| UserId via header on first request | Cookie isn't in request until second request |
| UserId as initial state (not useEffect) | Prevents hydration mismatch |

### What This Solves

- ✅ **First page load** - No flicker, correct variant from the start
- ✅ **Client-side navigation** - Already worked (bundle cached)
- ✅ **Page refresh** - UserId persisted in cookie
- ✅ **New users** - UserId generated on first request

---

## FAQ

**Q: Do multiple `useTraffical()` calls cause multiple network requests?**

No. The SDK fetches the config bundle once and caches it. All resolution happens locally.

**Q: What happens if the SDK fails to load?**

Defaults are returned. Your app works normally, just without experiment variations.

**Q: Should I use `tracking: "none"` for SSR?**

Yes, if you're calling `useTraffical` in a server context. On the client, use the default `"full"` tracking.

**Q: Can I change parameter values from the dashboard without deploying?**

Yes! That's the point. Parameters are resolved from Traffical's config bundle, which updates independently of your code.

---


## Migration from Deprecated Hooks

The `useTrafficalParams` and `useTrafficalDecision` hooks are deprecated but still available for backward compatibility.

### useTrafficalParams → useTraffical

```tsx
// Before (deprecated)
const { params, ready } = useTrafficalParams({
  defaults: { 'ui.hero.title': 'Welcome' },
});

// After
const { params, ready } = useTraffical({
  defaults: { 'ui.hero.title': 'Welcome' },
  tracking: 'none',
});
```

### useTrafficalDecision → useTraffical

```tsx
// Before (deprecated) - auto exposure
const { params, decision } = useTrafficalDecision({
  defaults: { 'checkout.ctaText': 'Buy Now' },
});

// After
const { params, decision } = useTraffical({
  defaults: { 'checkout.ctaText': 'Buy Now' },
});

// Before (deprecated) - manual exposure
const { params, trackExposure } = useTrafficalDecision({
  defaults: { 'checkout.ctaText': 'Buy Now' },
  trackExposure: false,
});

// After
const { params, trackExposure } = useTraffical({
  defaults: { 'checkout.ctaText': 'Buy Now' },
  tracking: 'decision',
});
```

---

## License



