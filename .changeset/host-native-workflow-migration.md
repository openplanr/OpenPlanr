---
"openplanr": major
---

Move semantic planning and implementation into the active coding agent. This is a
breaking CLI change: `planr plan`, `planr spec decompose`, and the model-backed
pipeline, estimate, refine, revise, and evidence command roots are retired. The
CLI no longer accepts AI-provider configuration or calls model providers.

Use the installed Plan, Spec, Ship, and review skills for semantic work, with the
current repository context and the host's own models and tools. Existing manual
artifact CRUD, document readers, integration commands, rendering, local studios,
dashboard, setup, and diagnostics remain available. Existing `planr`,
`openplanr`, and `opr` binary names still use the same parser.
