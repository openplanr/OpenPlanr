## Problem

<!-- One or two sentences. Link the issue if there is one. -->

## Change

-

## Testing

- [ ] `npm run generate && git diff --exit-code HEAD --`
- [ ] `npm run check:generated && npm run check:boundaries && npm run check:preservation`
- [ ] `npm run check:docs && npm run check:diagrams`
- [ ] `npm run lint && npm run test:focused`
- [ ] Workspace tests for the packages touched
- [ ] `npm run verify:packed:strict` when shipped package bytes change

## Boundaries

- [ ] No hand edits under generated paths; canonical sources changed and regenerated
- [ ] Deleted or edited compatibility paths are registered in the preservation catalog
- [ ] A changeset is included for every published package that changes
- [ ] No private planning material, credentials, or customer content
