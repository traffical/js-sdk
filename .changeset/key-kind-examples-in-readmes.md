---
"@traffical/js-client": patch
"@traffical/node": patch
"@traffical/openfeature-web": patch
"@traffical/react-native": patch
"@traffical/react": patch
"@traffical/svelte": patch
---

Docs: use real Traffical key formats in examples, and the right key kind per example.

Every example showed a Stripe-shaped placeholder — `apiKey: 'pk_...'`,
`api_key="sk_..."`, `'your_sdk_key'` — none of which is a Traffical key. That was
always wrong, and it became actively misleading now that `traffical_pk_` is a real
key class: `pk_...` reads like a truncated genuine key rather than a placeholder.

Examples now show `traffical_pk_…` or `traffical_sk_…`, chosen per example by where
the code runs. Browser packages (`js-client`, `react`, `react-native`, `svelte`,
`openfeature-web`) show the publishable key; `node` shows the server key.

Two specifics worth calling out:

- **Server-Evaluated Mode needs a server key.** `/v1/resolve` rejects publishable
  keys, so `evaluationMode: 'server'` only works from a backend. The root README now
  says so explicitly instead of leaving it to a 403.
- **Browser env vars are now named for the key they hold** — `PUBLIC_TRAFFICAL_PUBLISHABLE_KEY`
  (SvelteKit) and `NEXT_PUBLIC_TRAFFICAL_PUBLISHABLE_KEY` (Next.js), each with a note
  that the value is compiled into the client bundle and must be a `traffical_pk_…`
  key. Nothing in the SDKs reads these names — you pass `apiKey` yourself — so this
  is a documentation change, not a breaking one.

Documentation only. No runtime behaviour changed in any package.
