# Diagram edit kernel

The shared authoring kernel turns one completed diagram edit into a validated
transaction, an isolated preview and a conditional inverse. Canvas controls,
local tools and hosted adapters use the same rules. It operates on the
[Protocol 1.13 authoring bundle](authoring-contracts.md), with semantic content
and shared presentation paired in one snapshot.

This library provides the edit foundation. It does not provide a canvas editor,
file persistence, company authorization, Mermaid conversion or live collaboration. Existing diagram rendering and review remain separate APIs.

## Import and preview

The public package boundary is `planr-pipeline/diagram-authoring`. Monorepo
consumers use `@openplanr/artifact/diagram-authoring`; generation produces the
same self-contained runtime and declarations inside pipeline.

```js
import {
  compileDiagramCommand,
  previewDiagramTransaction,
  createConditionalInverse,
  diffDiagramBundles,
  validateAuthoringBundle,
} from 'planr-pipeline/diagram-authoring';

export function previewMove(bundle, ids, transactionId) {
  return compileDiagramCommand(
    bundle,
    { type: 'move', ids, dx: 24, dy: 0 },
    { transactionId },
  );
}
```

Supply the transaction ID once per completed gesture. Create, group and copy
commands also receive their new element IDs from the caller. The kernel has no
clock, random generator, filesystem, network, DOM or model connection.

The five exported functions have these responsibilities:

| Function | Result |
| --- | --- |
| `validateAuthoringBundle(bundle)` | `{ ok, diagnostics }` for inert content and diagram invariants. |
| `compileDiagramCommand(bundle, command, { transactionId })` | An atomic preview, a cancellation/unchanged result, or located diagnostics. |
| `previewDiagramTransaction(bundle, transaction)` | Applies exact operations to a private working copy and validates the complete result. |
| `diffDiagramBundles(before, after)` | Separate semantic and presentation changes plus affected/read/write IDs. |
| `createConditionalInverse(current, inverse, { transactionId })` | A newly based compensating transaction if the affected state still matches. |

A successful edit returns `bundle`, `transaction`, `diff`, `impact` and `inverse`.
A failure returns `{ ok: false, diagnostics }`; it never returns an applicable
partial bundle. Diagnostics use the Protocol `path`, `rule` and `detail` fields.
Render them as text, including any labels or paths derived from submitted data.

`{ type: 'cancel' }` returns `{ ok: true, cancelled: true, transaction: null }`.
An unchanged command may return `{ ok: true, changed: false, transaction: null }`.
Handle the `transaction: null` case before accessing preview content. Neither
result is a revision, persistence receipt or reason to show “Saved”.

## Commands and shared intent

Commands are a closed vocabulary; unknown fields fail. The exported
`DiagramCommand` union documents their exact typed inputs.

| Command | Inputs and effect |
| --- | --- |
| `create` | Semantic `elements` and matching `presentation` entries with supplied IDs. |
| `rename`, `describe` | An element `id` and `label`, or a node `description`. |
| `reconnect` | Connector `id`, `from` and `to` node IDs. |
| `move`, `resize` | Selected `ids` plus `dx`/`dy`, or one `id` and complete `bounds`. |
| `geometry`, `appearance` | Typed before/after `changes` for geometry or appearance/locks. |
| `reparent` | Selected `ids`, `parentId` (or `null`) and optional membership `index`. |
| `group`, `ungroup` | A supplied group ID/label and placement plus member IDs, or selected container IDs to dissolve. |
| `reorder-lanes` | Every lane ID in the intended order. |
| `duplicate`, `paste` | Selected IDs, a complete supplied `idMap`, optional `dx`/`dy`; paste also receives `sourceBundle`. |
| `delete` | Selected IDs and the exact `confirmedImpact` shown to the author. |
| `cancel` | No persisted change. |

Coordinates are global canvas coordinates. Reparenting preserves world placement;
moving a container translates descendants once. A resize cannot silently place
children outside their container. Geometry locks reject changes to the protected
position, size or route until an explicit appearance/lock operation unlocks it.
Selection, camera, temporary collapse and guides are view state, not commands.

Duplicate and paste copy the selected containment closure and internal connectors
using supplied fresh IDs. Their disclosures identify excluded external
relationships and detached annotations. They do not fabricate connections into
uncopied content. Historic review references remain outside the editable bundle.

Calling `delete` without matching confirmation returns a `confirmation-required`
diagnostic and `deletionImpact`. Show its element, relation, annotation,
membership, reading-order and emphasis IDs before retrying with that exact
`confirmedImpact`. If the diagram changed in the meantime, compile again against
the current snapshot and present the changed impact.

The persisted operations remain the six Protocol operation classes. A whole
batch succeeds or fails; temporary construction order is allowed, but the final
bundle must have valid graph references, containment, source correspondence and
paired presentation. Optional insertion positions preserve collection order
when restoring deleted objects and emphasis entries.

## Diffs, undo and storage boundaries

Diffs are keyed by stable element identity. `semantic` describes meaning and
membership; `presentation` describes bounds, routes, labels, appearance and
locks. Derived digest changes are excluded. `impact` contains conservative
`affectedIds`, `readIds` and `writeIds`, including relevant connectors and
containment dependencies.

Keep the returned inverse with the accepted gesture. To preview undo, re-read
current authoritative content, then call:

```js
export function previewUndo(currentBundle, inverse, transactionId) {
  const result = createConditionalInverse(currentBundle, inverse, { transactionId });
  return result.ok
    ? previewDiagramTransaction(currentBundle, result.transaction)
    : result;
}
```

Undo compares changed fields and dependencies with their expected post-state.
An unrelated edit can survive a newly based inverse; overlapping changes,
removed objects or changed dependencies produce a conflict. The inverse never
replaces an old whole document over newer content. The undo preview supplies its
own inverse for redo. Keep inverse values intact rather than treating their
internal guard data as editable application state.

Adapters own saving, identity, permissions, idempotency, revision allocation and
atomic compare-and-set. Before committing, an adapter must re-read authoritative
state and invoke this kernel against it. A successful preview alone is not a
saved revision or an authorization grant. Original source bytes remain unchanged;
source-map operations maintain correspondence when deletion or undo affects
mapped objects.

## Contributor checks

Edit canonical files under `packages/artifact/lib/artifact/diagram/authoring/`.
Protocol owns the transaction representation. `npm run generate` rebuilds public
distribution copies; never edit generated pipeline modules directly.

Run the focused authoring, runtime-parity and boundary tests, then the existing
isolated packed-package proof when changing this API. The packed proof imports
the public subpath, compiles a real create/undo round trip, and typechecks a
consumer without private workspace dependencies.
