---
"openplanr": patch
---

Update generated rule templates to reference **Sonnet 5** (was Sonnet 4.6) for the analysis/decomposition tier, matching planr-pipeline v0.24.10. The cursor (`planr-pipeline.mdc.hbs`, `agents/designer-agent.md`, `agents/qa-agent.md`, `agents/specification-agent.md`) and codex (`_pipeline-section.md.hbs`) rule-generator templates now render the current analysis-tier model. The DEV/codegen tier stays on Opus 4.8.
