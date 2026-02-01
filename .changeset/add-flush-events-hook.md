---
"@traffical/react": patch
---

feat(react): Add flushEvents() to useTraffical return value for immediate event dispatch

Users can now flush pending events immediately after critical conversions
(like purchases) before page navigation:

```tsx
const { params, track, flushEvents } = useTraffical({ defaults: {...} });

const handleCheckout = async () => {
  track('purchase', { value: total });
  await flushEvents(); // Ensure event is sent before navigation
  router.replace('/checkout/success');
};
```
