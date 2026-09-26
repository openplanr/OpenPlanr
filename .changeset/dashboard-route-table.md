---
'planr-pipeline': patch
---

The dashboard server dispatches requests through an ordered route table in `lib/dashboard/server/routes.mjs`, with one module per route family and the Planning and live-event envelope contracts in `lib/dashboard/planning-envelopes.mjs`. Every route, status code, header and response body is unchanged, and `lib/dashboard/server.mjs` keeps its exports.
