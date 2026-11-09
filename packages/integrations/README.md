# @openplanr/integrations

Deterministic GitHub transport, Linear identifier and status reconciliation, and
mapping primitives for the OpenPlanr CLI. `openplanr sync tracker` runs the GitHub
transport, which starts `gh` with an allowlisted environment (`GH_ENVIRONMENT`).
Linear transport and its credentials live in the CLI (`openplanr linear`).

This package performs no model inference and contains no AI provider client.
