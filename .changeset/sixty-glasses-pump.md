---
"@traffical/js-client": minor
"@traffical/node": minor
---

New requestTimeoutMs option (default 10s, matching the repo's \*Ms idiom; core-io's AbortController pattern) on the browser config fetch + event POST, and — discovered during the work — the node package's config fetch and event batcher had the identical bug, fixed the same way. Aborts flow down the existing offline-warning / persist-for-retry paths; timers cleared in finally. The unload keepalive beacon path was deliberately left timeout-free (documented).
