# OPERATE-SPEC-003 skills work item

Umbrella specification: `SPEC-003`
Release participant: `@openplanr/skills@1.21.0`

The public `planr-operate` skill is a thin presentation adapter generated from
the pipeline contract. It presents CLI-owned question IDs and typed actions,
returns answers on bounded stdin using the questionnaire's self-describing
`submission` contract, and treats an explicit request to run one
cycle as authority for its reversible native prepare/record/finalize/Chair/report
lifecycle. It stops at external provider, governance, planning, PLAN, SHIP, and
external-effect boundaries and uses only the supported evidence-diagnosis path.
Each advisor emits exactly the compact response schema embedded at
`rolePack.roleBrief.output.jsonSchema`; it never synthesizes the canonical
role-result wrapper, producer metadata, or digests.

Schema 1.1 questionnaires provide exact argv tokens, immutable envelope fields,
answer metadata and value types, the digest pointer, and the 65,536-byte limit.
Adapters copy that contract verbatim and never reverse-engineer missing envelope
metadata.

The skill must not copy the questionnaire, infer an answer/default, edit
operating journals, inspect private evidence state, or invoke PLAN/SHIP
automatically. It may add `--yes` only to the exact digest-bound cycle start
selected by the user's explicit run request. It must present the concise brief
and per-lens Markdown/JSON reports; the dashboard is never the only output.
