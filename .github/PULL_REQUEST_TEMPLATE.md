## Problem

<!-- One or two sentences. Link the issue if there is one. -->

## Change

-

## Testing

- [ ] `npm run generate && git diff --exit-code HEAD --`
- [ ] `npm run check:generated && npm run check:boundaries`
- [ ] `npm run check:docs && npm run check:diagrams`
- [ ] `npm run lint && npm run test:focused`
- [ ] Workspace tests for the packages touched
- [ ] `npm run verify:packed:strict` when shipped package bytes change

## Boundaries

- [ ] No hand edits under generated paths; canonical sources changed and regenerated
- [ ] Changed package exports and compatibility behavior are covered by the relevant consumer checks
- [ ] A changeset is included for every published package that changes
- [ ] No private planning material, credentials, or customer content
