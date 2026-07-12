---
name: planr-plan
description: Run the feature-local OpenPlanr pipeline PO phase and stop for review.
license: MIT
---

Run `planr pipeline plan <feature>` through the active runtime adapter. If a spec
or stack template is scaffolded, stop so it can be completed. Otherwise produce
stories and no more than two tasks per story, record provenance, summarize the
artifacts, and stop. Never chain to SHIP.
