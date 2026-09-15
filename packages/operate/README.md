# `@openplanr/operate`

Canonical MIT workspace package for the deterministic Operate v2 runtime. It depends
only on `@openplanr/protocol` inside the OpenPlanr workspace. The public CLI
parser remains in `openplanr`, while `planr-pipeline` receives generated,
self-contained compatibility copies from `scripts/domains/project-domains.mjs`.

This workspace is not published independently.
This workspace is npm-private; its source remains part of the public MIT monorepo.
Its required runtime is distributed through the public CLI and pipeline packages.
