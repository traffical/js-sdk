# Decoupled Attribution: Decision-Level Layer Resolution

## Summary

The resolution engine now processes **all** layers in the bundle for every
`decide()` call, regardless of which parameters the caller requests. Layers
without matching parameters are marked `attributionOnly: true` to distinguish
them from layers that actively resolved parameters.

This fixes a bug where `decide()` with `defaults: {}` (or defaults that only
matched a subset of layers) produced empty or incomplete
`decision.metadata.layers`, causing downstream analytics and metric systems
to lose track of which experiments the user was assigned to.

## The Problem

The resolution engine previously coupled two concerns:

1. **Parameter resolution** — "what value should `checkout.cta` have?"
2. **Attribution / assignment** — "which experiment allocations is this user in?"

Both were gated behind the same filter:

```typescript
const layerParams = paramsByLayer.get(layer.id);
if (!layerParams || layerParams.length === 0) continue; // skipped entirely
```

If no parameters from a layer were requested in `defaults`, the entire layer
was skipped — including bucket computation, policy matching, and allocation
resolution. This meant `decision.metadata.layers` only contained entries for
layers with matching parameters.

### Consequences

- **Decision and exposure events** carried incomplete `layers` data, so
  downstream systems couldn't determine which experiments the user was
  assigned to.

- **Track-event attribution** derives from `decision.metadata.layers` via the
  client's cumulative attribution map. Empty layers = empty attribution on
  track events.

- **`defaults: {}` use case** — e.g. tracking-only integrations that call
  `useTraffical({ defaults: {} })` to get a `decisionId` for metric tracking
  without resolving any specific parameters — produced completely empty
  decisions with no layer data at all.

## The Fix

### `resolveInternal` (engine.ts)

The layer processing loop now iterates **all** layers in `bundle.layers`:

- **Bucket computation** always runs (FNV-1a hash, negligible cost).
- **Policy matching** always runs (bucket eligibility, conditions, allocation
  matching).
- **Parameter overrides** are only applied if the layer has matching parameters
  (`hasParams` guard).
- The `LayerResolution` entry is pushed for every layer, with
  `attributionOnly: true` when the layer had no matching parameters.

### `LayerResolution` type (types/index.ts)

New optional field:

```typescript
interface LayerResolution {
  // ... existing fields ...
  /**
   * When true, this layer was resolved for attribution/assignment purposes
   * only — no parameters from this layer were requested by the caller.
   */
  attributionOnly?: boolean;
}
```

### `trackExposure` (js-client/client.ts)

Skips layers with `attributionOnly: true`:

```typescript
for (const layer of decision.metadata.layers) {
  if (!layer.policyId || !layer.allocationName) continue;
  if (layer.attributionOnly) continue; // ← new guard
  // ... fire exposure event
}
```

This prevents exposure inflation — exposure events are only fired for layers
where the calling component actually requested parameters.

## Design: Decision vs Exposure

This change formally separates two concepts that were previously conflated:

| Concept | What it means | When it fires | Used for |
|---------|---------------|---------------|----------|
| **Decision** (assignment) | User is bucketed into an allocation for this layer | Every `decide()` call, all layers | Intent-to-treat analysis, metric joins, attribution on track events |
| **Exposure** | User actually saw the variant's parameters | Only for layers with requested parameters | Exposure-based analysis, per-protocol stats |

Attribution moves from being exposure-scoped to decision-scoped. This means:

- `decision.metadata.layers` is now **exhaustive** — it includes all layers in
  the bundle, not just those with matching parameters.
- Track-event `attribution` (built from cumulative layers) includes all
  experiments the user is assigned to.
- Exposure events remain scoped to layers the component actually uses.

**Nothing is lost.** Exposure events still provide the same granularity as
before — you can always distinguish "user was assigned" (decision) from "user
saw the variant" (exposure) using the event type and the `attributionOnly` flag.

## Performance

The change adds bucket computation (FNV-1a) and policy matching for previously
skipped layers. FNV-1a is ~nanoseconds per call. Condition evaluation
short-circuits on first miss. Even with 100 layers, the overhead is negligible
compared to network I/O for fetching the bundle.

## Testing

New test suite: `decide - attribution-only layers` in `engine.test.ts`:

- Layers with matching params are NOT marked `attributionOnly`
- Layers without matching params ARE marked `attributionOnly`
- Empty defaults produces all layers as `attributionOnly`
- Empty defaults does NOT modify assignments
- Attribution-only layers do not apply parameter overrides
- `decisionId` is generated even with empty defaults
- Requesting params from one layer does not affect the other

All existing tests continue to pass unchanged — the fix is backward compatible.
