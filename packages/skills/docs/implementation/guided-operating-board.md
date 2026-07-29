# OPERATE-SPEC-003 skills work item

Umbrella specification: `SPEC-003`
Release participant: `@openplanr/skills@1.17.0`

The public `planr-operate` skill is a thin presentation adapter generated from
the pipeline contract. It presents CLI-owned question IDs and typed actions,
returns answers on bounded stdin, stops at each mutation/provider boundary, and
uses only the supported evidence-diagnosis path.

The skill must not copy the questionnaire, infer an answer/default, append
`--yes`, edit operating journals, inspect private evidence state, or invoke
PLAN/SHIP automatically.
