# Shared diagram editor session

The portable `planr-pipeline/diagram-editor` entry point owns editing state for
local and future hosted shells. It uses the existing typed edit kernel and one
semantic/presentation bundle. It contains no filesystem, Design, company identity
or model client. `planr-pipeline/diagram-owner` is its separate Node-only local
transport. Both have TypeScript declarations.

These APIs provide editing state, shared browser controls and local persistence.
Hosts supply transport, identity and optional review adapters; the editor never
infers company authority from document content.

## Local use

```js
import { createDiagramAuthoringStore } from 'planr-pipeline/diagram-authoring-store';
import { createDiagramEditorDraft, openDiagramEditorSession } from 'planr-pipeline/diagram-editor';

const store = createDiagramAuthoringStore({ root: process.cwd(), slug: 'checkout' });
const draft = createDiagramEditorDraft({ diagramId: 'checkout', title: 'Checkout' });
if (!draft.ok) throw new Error(draft.diagnostics[0].detail);
const editor = await openDiagramEditorSession({ transport: store, create: draft.bundle });
// Use editor.submit(command) with the typed authoring vocabulary.
// An unsaved blank draft is valid; Save initializes the complete bundle.
await editor.save();
editor.dispose();
```

## Shared browser controls

`mountDiagramEditor({root, session, host})` mounts the framework-neutral canvas,
outline and inspector used by local and hosted owner shells. Import its stylesheet
from `planr-pipeline/diagram-editor.css`. The returned controller exposes
`openSourcePanel({tab})` so a host can open the same Mermaid copy workflow without
reimplementing conversion or fidelity decisions.

A hosted shell adapts the same editor through `host` instead of forking it:

- `labels` replaces the `subtitle`, `emptyHint` and `reviewUnavailable` wording
  where the host changes what is true, such as where a diagram is shared.
- `brand: false` removes the OpenPlanr mark for a host that shows its own.
- `review: false` removes the Review tab when the host has no reviewer adapter.
- `colorScheme` (`'light'`, `'dark'` or `null`) follows the host's theme toggle
  instead of the operating system; `setColorScheme()` changes it later.
- `actions` add command-bar buttons after Save. Each has a lowercase `id`, a
  `label`, an optional editor icon, and `disabled(state)`/`hidden(state)` hooks.
- `panels` add right-panel tabs. `mount({root, session, select, close})` runs the
  first time a panel opens; the cleanup it returns runs on dispose. `properties`
  and `review` are reserved ids.

Invalid host options throw a `TypeError` that names the option. The controller's
`openPanel(id)` opens a tab and `refreshHost()` re-runs the action and panel hooks
after host data changes.

`mountDiagramSourcePanel({root, session, ...callbacks})` is the smaller host-neutral
boundary for a company shell that already owns its surrounding dialog. It accepts
only `getState()` and `adoptInitialCopy()` from the editor session. Pasted and
uploaded Mermaid are unlinked snapshots: M1 provides no repository path, watch or
write authority. A copy may initialize only a new, empty, unsaved diagram, and a
partial conversion requires acknowledgement tied to that exact preview. Bundle,
Mermaid and SVG downloads remain separate because they preserve different data.
Load `planr-pipeline/diagram-editor.css` with this direct mount. The controller adds the scoped `planr-diagram-source-panel` class when the
root is outside the full editor, giving company shells the same responsive light,
dark, forced-color and reduced-motion treatment without styling the surrounding
page. The class is removed when the controller is disposed.

Templates are validated bundles copied with a new diagram identity. Their element
IDs remain scoped to that new diagram; source-link custody is detached. Clipboard
copies contain only the selected self-contained semantic/layout fragment, at most
1,000 objects and 1 MiB. Paste delegates identity remapping and relationship checks
to the same edit kernel.

## Gesture and view ownership

The session owns one camera `{x, y, scale, fit}` with
`screen = world * scale + offset`. Selection, collapsed groups, tracing and snap
preferences stay outside document content. Equal revision refresh is a no-op.
Subscriptions announce affected IDs without forcing a complete bundle clone on
every event; shells request `getState()` when they need a detached snapshot.

`beginGesture()` and `previewGesture(command)` preview relative to the original
content; pointer deltas are absolute deltas from gesture start. Only
`completeGesture()` adds one transaction and conditional inverse. An invalid
latest preview cannot commit an earlier valid one. `previewLayout()` uses the same
explicit preview/commit boundary. `bindDiagramEditorCancellation(editor, target)`
binds Escape, pointer cancel, lost capture and blur; the shell still owns the
actual pointer gestures and must remove these listeners when unmounting.

Geometry uses cached stable-ID bounds, labels and connector segments, with
screen-size tolerance through that camera. Spatial queries do no DOM or full
geometry scans. Content updates still validate the bundle and scan metadata for
correct dependency coverage, then resolve only changed objects, descendants and
incident connectors. Work counters distinguish these costs. A mixed 1,000-element
fixture verifies candidate reduction and affected updates; it is not an end-user
latency benchmark or a claim that interactive performance targets have been met.

## Save, conflict and recovery

Only an exact owner acknowledgement marks a revision saved. Pending transactions
retain their IDs and canonical bytes after uncertain outcomes. A late response
cannot clear later edits. Retrying an already committed transaction returns its
original receipt. A historical receipt cannot replace a newer revision already
observed by the session.

A hosted transport may implement `saveBatch(batch)` in place of `initialize` and
`commit`. Each Save then sends one request with the pending transactions, the
expected base (or the initialization for a new diagram) and the resulting bundle.
`batchId` is stable for the same transactions, so the owner can treat a repeated
batch as already applied. After an uncertain outcome the session resends that exact
batch, including after a reload through recovery, before any newer edits. A
definitive 4xx rejection other than 408 or 429 ends the batch, so the next Save
rebatches every pending edit. A 409 or stale base reports a conflict, and 401 or 403
reports `access-changed`.

When access is lost, recovery is cleared by default. A host whose owner read
returns a scope bound to the signed-in identity can pass
`retainRecoveryOnAccessLoss: true` so a user who signs back in to the same scope
does not lose unsaved edits.

Refresh with a new base while edits or a gesture are pending retains that draft and
exposes a comparison. Undo/redo use expected-current-value compensation; they never
restore an old whole-document snapshot over another author's work.
`useAuthoritative()` deliberately discards a draft and must be offered alongside
comparison/export by the mounting UI. It cannot run while a save is in flight.
Derived rendering/export is separate from Save and cannot undo its acknowledgement.

A browser host can use `createDiagramEditorRecovery` with `sessionStorage` and the
opaque recovery scope returned by its authenticated owner read. Records contain the
base bundle and exact pending transactions, never owner URLs or tokens. Recovery is
bounded to 100 transactions and 2 MiB. The host must not substitute a scope taken
from untrusted document data. Recovery supports refresh within the same owner
session; restarting the daemon gives a new scope. A blocked or full store reports
memory-only recovery. Invalid records are retained for inspection, not applied or
silently replaced. Recovery data is untrusted and never establishes a saved state.

## Owner HTTP boundary

`startDiagramOwner({root, slug})` binds one verified filesystem scope before issuing
an owner capability. Requests under `/o/{id}/{capability}/api/` provide only bundle
or transaction data, never a source path. `read`, `initialize`, `commit` and `recover`
reuse the durable store's base, replay, custody and recovery checks. The existing
loopback Host/Origin protections apply, with an explicit owner header and bounded
UTF-8 JSON. Review `/r/` capabilities and shared artifacts cannot access these routes.

The browser's `createDiagramLocalOwnerTransport({apiBase})` requires its exact
loopback origin, rejects redirects and bounds response bytes. Normal browser Origin
headers are used for writes. The returned `baseUrl` is an API authority, not a finished
editor page; the mounting host supplies that shell. Closing the server drains
in-flight saves.

The local store's documented same-OS-user security limits still apply. No hosted
identity, production service, package publication or company authorization changes
are part of this implementation.
