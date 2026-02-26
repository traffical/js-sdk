---
"@traffical/core": minor
---

Add SDK-side contextual bandit scoring — reads policy.contextualModel from the bundle, computes per-allocation scores via linear dot-product, applies softmax with gamma temperature and probability floor, and deterministically selects an allocation
