# Procedure: Strategy `ASK_STACK` (Step 0.6)

Greenfield + no stack hint in `BRIEF`. Pipeline cannot infer intent.

Print and stop. Write nothing.

```
⚠ State: ask-stack

Greenfield directory detected, but no stack mentioned in your brief.

Please re-run with one of:
  (a) A brief that declares the stack:
      /planr-pipeline:plan ${SLUG}
      <feature description>
      Stack: Next.js + Prisma + Postgres + Anthropic SDK + Vitest

  (b) An existing input/tech/stack.md authored by hand from
      ${CLAUDE_PLUGIN_ROOT}/templates/stack.md.tpl
```
