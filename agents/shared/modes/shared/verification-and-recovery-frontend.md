<!-- Loaded by the frontend agent in both planning modes. -->

## Verification and recovery

After a coherent frontend change, run the relevant commands from
`input/tech/stack.md`: lint, type checking, build, tests, and browser checks when
they apply. Choose focused checks first, then broaden verification in proportion
to the change and its risk.

When a check fails:

- inspect the actual error and the affected component, state, route, or styling
  context;
- fix the cause rather than weakening assertions, skipping checks, hiding a type
  error, or accepting a visual regression;
- rerun the affected check, then the broader relevant suite once it passes;
- widen context or change approach when the current approach is not converging.

Continue while the observed results suggest a useful next step. When progress is
not possible because of a missing material decision, inaccessible dependency, or
environment failure, return the failing command or operation, the relevant error,
what was tried, the affected requirement, and the next useful action. A separate
failure artifact is unnecessary unless the caller requested one.

Project learning notes are optional. Record one only when it will materially help
future work and the project already provides an appropriate place; never create or
update memory as a condition of completing the task.
