# Canonical role registry

> Generated from `registry/roles.json`. Do not edit this table by hand.

| Role | Phase | Activation | Capability | Write boundary |
|---|---|---|---|---|
| db-agent | po-preflight | conditional | analysis-high | output/db/schema.json only; database is read-only |
| designer-agent | po | conditional | analysis-high | design-spec.md only |
| specification-agent | po | always | analysis-high | stories and task specifications only |
| entity-scaffold-agent | po-preflight | manual | analysis-high | output/src persistence scaffolding only |
| frontend-agent | dev | conditional | implementation-high | task Create/Modify UI paths only |
| backend-agent | dev | conditional | implementation-high | task Create/Modify tech paths only |
| qa-agent | qa | always | read-only-qa | qa-report.md only; source is read-only |
| devops-agent | post-build | conditional | analysis-high | declared infrastructure configuration only; never deploy |
| doc-gen-agent | post-build | conditional | analysis-high | Docs feature output only |
