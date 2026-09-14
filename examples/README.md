# Examples

Executable protocol examples live with their validating tests so examples cannot drift from schemas. Start with:

- `tests/protocol/` for Protocol 1.5 role, task-kind, task/output manifest, command, rule, skill, generated-asset, and migration-preservation contracts.
- `tests/skill-runtime/` for declarative skill composition and host rendering.
- `packages/pipeline/tests/fixtures/` for compatibility fixtures covering Protocol v1.0–v2.0.

Examples added here must have a focused validator or test and must use canonical `planr-*` identifiers.

Internal product showcases belong under the ignored `examples/design/` directory.
Keep their authored source, originals, review context, and revision history locally
for design iteration. These are not public package inputs. Do not move an attached
design just to clean Git status: its local review may depend on that path.

Reusable public examples and automated test fixtures stay versioned. Rendered
previews and personal review state in `.design/` are ignored everywhere.
