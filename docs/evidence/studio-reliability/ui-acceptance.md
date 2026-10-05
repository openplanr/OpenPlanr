# Studio UI acceptance evidence

This map describes implemented canonical interfaces and synthetic browser verification. It does not claim deployed behavior or a complete signed-in Company workspace journey. Final package generation and exact-consumer reruns remain release gates owned by the root task.

## Control inventory

| Surface | Shared component owner | Identity and navigation | Review and annotation | Presentation and export |
| --- | --- | --- | --- | --- |
| Local/hosted Design | `artifact/ui/studio-shell-components.tsx` through `mountDesignStudioChrome` | One toolbar; Design badge; Screens; Canvas / Prototype / Walkthrough | Review thread rail; Interact / Annotate / Inspect remains controller-owned; canonical annotation composer | Portable HTML / Screen PNG through the canonical keyboard menu; shared feedback exporter retains explicit revision scope |
| Rendered local/hosted diagram | Same toolbar/button/menu primitives through `mountDiagramStudioChrome` | One toolbar; Diagram badge; diagram Navigator; scene/element outline | Interact / Annotate / Inspect; Review thread rail or compact dialog; modal element/point/region composer | Present / Exit presentation; Previous/Next chapter labels and independent title/progress; one Export menu for native SVG/PNG and scoped feedback |
| Authored diagram/local owner/embed | Same toolbar/button/menu primitives through `mountDiagramEditorChrome` | Host title/subtitle/status kept as stable DOM seams; Diagram badge; editing tools and host panels | Host Review/Inspect capability; keyboard/pointer editing retained; inspector and review are distinct | Light/Dark versioned presentation action; existing authoring export callbacks and host actions preserved; no fabricated published presentation capability |
| Company actual `WorkspaceToolbar` | `@openplanr/pipeline/studio-shell` in the existing React root | One canonical header; project hierarchy, artifact title, kind badge, revision/status, theme | Actions: Review, Inspect, Revisions; annotation uses native diagram/pin context or Design review target | Capability-aware Actions: Present, Access, Design handoff, Export current source, Export review · JSON, Export comments · Markdown |

Differences above are explicit capability/format differences. Company authentication, artifact navigation and authored canvas controllers remain their existing owners. The actual Company toolbar has 9 Actions for the synthetic manager Design fixture; it has fewer when capabilities are absent. No duplicate React runtime is bundled: hosted generators resolve the consumer's lockfile-pinned React/DOM19.2.8; root marketing19.2.4 remains independent.

## Shared Studio criteria

| Original criterion | Implementation and persistent evidence | Current verification limit |
| --- | --- | --- |
| Corresponding control/copy inventory | Inventory above; `diagram-studio.test.mjs`, `studio.browser.test.mjs`; actual Company `test-company-studio-toolbar.mjs` | Local/hosted runtime covered. Actual Company parent/controllers pass in the exact synthetic repair overlay; the protected canonical parent remains unchanged pending authorization. |
| Annotate element/point/region uses established modal; cancel, Escape, focus, drafts | `diagram-studio.browser.test.mjs` semantic anchored feedback; hosted `test-diagram-share-browser.mjs` exercises composer draft, cancel, reopen and selection | Final exact hosted candidate rerun pending at this receipt. |
| Review thread browser; no automatic sidebar composer; Inspector findable | Canonical controller keeps modal composer separate from Review; hosted Design/Diagram scripted journeys | Company target-selection callback covered by toolbar/preview tests, full signed-in thread journey not claimed. |
| Published revision and stable target/coordinates; zoom/resize/reload; history read-only | Canonical comments/coordinate/export browser test; hosted Diagram authored manual geometry and old-revision isolation; encrypted v2 authenticated catalog `reviewOf` | Final candidate hosted rerun pending. |
| Presentation title/progress, arrow labels, disabled behavior | Canonical native presentation journey; `verify-studio-interface.mjs` captures presentation title/export and disabled Previous at every requested width/theme | Final-candidate screenshot matrix pending; old partial capture is not a pass. |
| Shared export rows/keyboard and SVG/PNG/Markdown/JSON scopes | Canonical Radix `StudioMenu`; hosted Diagram asserts actual native downloads and current/all feedback, keyboard menu behavior | Final candidate and screenshots pending. |
| One primary export entry point | `mountDiagramStudioChrome` creates one Export menu; local/shared one markup builder | Actual canonical browser sees one toolbar and one Export entry. |
| Continuous canvas, saved geometry/hit testing/export unchanged | Parent rendering changes; canonical native browser asserts transparent scene/page paint, geometry and source export custody; versioned palette tests | Historical palette semantics retained. Explicit brand Light/Dark stored only through new versioned transaction. |
| Equivalent states/contrast/touch targets | Shared token-adapted buttons/menu; canonical light/dark hover/open/focus contrast browser test; Company 48 cases across 3 engines | Final hosted hover/disabled screenshots pending. Company oppositeOS/application-theme settled contrast is at least5.03775 across144measured controls; no brand token change. |
| 375/390/768/1440+, panels deliberate/no overflow | Canonical phone test and constrained600px host test; embedded390/900px tests; hosted interface script; Company toolbar48cases | Company exact repair overlay passes all16 width/theme/text-size cases per engine. Canonical protected-parent replacement remains pending authorization. |
| Present/Exit/Annotate/Interact/Review/Inspect immediate active state | Controller datasets subscribed into React; React owns control text; canonical keyboard/presentation and selection tests | Final hosted matrix exercises keyboard mode switch + Present/Exit. |
| Offline owner and cold hosted useful recovery | Hosted Diagram cold metadata retry, local owner stopped; transactional IndexedDB exact feedback and owner management; bootstrap loader retry | Generic room owner pause/lost-response/reload/reimport/resume/delete passed interim exact3c85, final exact-pack replay required. |
| Original three states before/after; compare local/Company | Original private baseline is `~/.gstack/projects/OpenPlanr/designs/design-audit-20260930-diagram-share/screenshots/{presentation-export,presentation-title,viewer-sidebar}.png`. Sanitized successor captures are generated under `.planr/diagrams/verification/studio-interface/` | Baselines contain customer content and are retained privately, never copied into public evidence. Company full-route overlay is verified separately from the toolbar. Signed-in production authentication and canonical protected-parent replacement are not claimed. |
| Canonical/downstream/assets/package checks before release | Canonical UI8 + asset 3 PASS11; embedded11 PASS; authoring82 PASS; declaration63 exports PASS; exact private generator check PASS; parent final generation/build/pack gates | Final packed private consumer/browser and independent interface review still required. |

## Focused reliability mapping

| Criterion | Concrete implementation | Persistent proof/result |
| --- | --- | --- |
| Authoring declaration binding | Every authoring JavaScript module and `diagram/source-map.mjs` uses `@ts-check`; declaration includes bind implementation exports; model generics, discriminated semantic maps and literal collections replace `any` | `npm run typecheck:declarations`: PASS63 exports; authoring82 unit tests PASS. `/private/tmp/studio-final-declarations4.log`, `/private/tmp/studio-authoring-bindings-proof.log` |
| Host and marker identity | All7reserved panel IDs rejected; validated host icon rendered; all DOM and SVG marker IDs per-mount, public export renderer remains unchanged | Actual two-editor browser all-ID uniqueness and invalid-host/icon tests; embedded11 browser PASS. |
| Container responsiveness | Root ResizeObserver drives compact layout; corresponding CSS uses root data attributes, fallback viewport only before first measurement; shared dialogs are positioned inside the host | New600px host on1440px window test checks actual dialog bounds and focus return; phone dialog test PASS. |
| Unused edit-mode removal | Removed nonexistent constant mode, edit predicate conjunct, stamp member and unused data-mode write | Strict compilation + real editable/read-only host browser behavior PASS. |
| One presentation resolver | One DOM-independent presentation resolver; renderers and stage re-export/import the same implementation | Stage/renderer presentation tests and package declaration gate; no second algorithm. |
| One viewer markup owner | One canonical diagram markup builder with explicit local/shared controls | `diagram-studio.test.mjs` structural parity; local/shared/hosted browser consumers exercise it. |
| Original browser stress | Readiness tied to valid frame/resource/controller state; reviewed journey semantic locator; strict header pixels unchanged, animation completion bounded | Original2tests ×20 reps ×Chrome/Firefox/WebKit =120 PASS under concurrency 4. `/private/tmp/openplanr-studio-stress-readiness/results.json` |
| Cursor resource parity | Cursor referenced resource paths and complete generated workflow body parity checked | `packages/pipeline/tests/orchestration/workflow-alias-parity.test.mjs`; parent final generated adapter gate must rerun. |
| Transactional feedback custody | Transactional actor/workspace/revision operation custody; exact body lease/retry; permanent quarantine; migration; malformed metadata and invalid payload cannot block valid entries | `review-outbox.browser.test.mjs`:3 PASS, including actual IndexedDB corruption and asynchronous callback settlement. Hosted v2 Design/Diagram adapters use it; exact final package rerun pending. |
| Company compact hierarchy | Canonical compact Company toolbar and capability-aware Actions; single toolbar responsiveness proven | Company toolbar48casesPASS; actual full parent/controllers57casesPASS acrossChrome/Firefox/WebKit in the exact96d42ad repair overlay, including single and8-frame canvas. Canonical protected-parent replacement remains pending authorization. |
| Company presentation controls | Canonical presentation controls shared by public viewers; private toolbar exposes Present capability | Actual Company overlay verifies Read, Inspect/Review/Present/Escape, same mounted frame, draft/camera retention and16 responsive/theme/text-size cases per engine. It covers synthetic server actions, not signed-in production authentication. |
| Company meaningful HTML fidelity | Private preview worker isolated from company session, typed opaque child bridge; company passive/unsupported fidelity states backend-owned | Company overlay compares exact body text and130 intrinsic geometry/font/path records against the independently executed synthetic complex source;36nodes/53connectors/6metrics/8stages/24rows remain complete in canvas and presentation. Shared counterpart passes interimChrome; final exact-pack3engine replay pending. |

## Prototype migration successor and security boundary

`packages/design/tests/prototype-migration.browser.test.mjs` proves the standard portable Studio preserves the seven caller-declared prototype fields across declared navigation and actual source-frame eviction. Passwords stay excluded. The configured alias contract is version1, bounded primitive strings only, max4000 characters each and16 KiB total snapshot. The relay requires opaque origin, exact registered source/window/screen/view and active43-character frame nonce; foreign-origin and stale nonce `ready` cannot retrieve a snapshot. Receive-only mode lets Company own its authenticated outer listener. No arbitrary execution/fetch or inbound legacy event ingestion exists.

The synthetic offline-note import is explicitly bound to the immutable original artifact digest and stable screen/frame coordinates, idempotent on repeated import, preserves original notes byte-for-byte and leaves the review decision pending. The read-only customer adapter/source inventory and documented successor receipt live at `the private planning evidence prototype-migration-receipt.json`; 192 source files and the old adapter remain untouched. This is a migration receipt, not a deletion or claim that customer content was published.

Proofs: `/private/tmp/prototype-migration-proof4.log`, `/private/tmp/prototype-nonce-proof.log`, `/private/tmp/openplanr-outbox-malformed-proof.log`. Independent private review discovered the former unbound self-listener; the correction and regression are explicit rather than hidden by a general sandbox claim.

## Exact verification logs

- `/private/tmp/studio-final-ui-proof3.log`: read-only Studio 8 + shell asset 3 PASS.
- `/private/tmp/studio-final-ui-proof2.log`: first 11 embedded-editor tests PASS with final host-relative dialog CSS; later read-only test locator failures are superseded by the complete passing finalread-only run above.
- `/private/tmp/studio-ui-final-types.log`: strict source compilation PASS.
- `/private/tmp/studio-final-declarations4.log`: implementation/declaration63 export binding PASS.
- `/private/tmp/studio-interim-hosted-generator-check.log`: exact interim3c85candidate generation `--check` PASS; comments normalized deterministically without copying source output.
- `/private/tmp/studio-owner-management-proof4.log`: synthetic real Miniflare/browser exact append and owner management receipt-loss/reload replay/pause/resume/delete PASS on interim3c85.
- `/private/tmp/op-private-company-toolbar-{chrome,firefox,webkit}.json`: actual Company toolbar 48 synthetic cases PASS; protected workspace parent not replaced.

Final pack hashes and completed hosted screenshot outcomes must be added after the root generation/package freeze. No final asset provenance or Company full-route claim is inferred from interim proofs.

## Additional source-freeze evidence

- `/private/tmp/studio-inspect-proof.log`: native Inspect keyboard/semantic selection, immediate active state and stable camera;9browser +5unit +3asset tests PASS.
- `/private/tmp/op-private-company-canvas-{chrome,firefox,webkit}.json`: actual Company parent/controllers57synthetic casesPASS on the exact96d42ad repair overlay. Includes single-frame body text/eight style records, complex passive snapshot130records,8-frame state/presentation and16responsive/theme/text-size cases per engine. The protected canonical parent remains untouched.
- `/private/tmp/studio-installed-skill-repair-proof.log`:14isolated Design/generation tests PASS, including stage runtime HTTP200, preserved state/restart/revision/failed rendering and93shared sources/465viewport references.
- `/private/tmp/studio-runtime-reader-proof.log`:2shared runtime asset tests PASS; tampered fragment bytes, root digest and traversal identities reject.
- `/private/tmp/studio-native-claude-validator.json`: actual strict Claude validator PASS with no errors or warnings. Directory437files, largest nonimage205,873bytes; complete77dependency attribution in86,071bytes. Limits remain512files and256KiB per nonimage.

These are synthetic fixture and packaged local-installation proofs. Final hosted package hashes and browser screenshots remain pending the root package freeze.

### Company diagram chrome in the existing React tree

The optional `host.mountChrome({ container, content })` seam mounts canonical editor chrome through a host portal; omission retains the synchronous standalone root. CompanyDiagramEditor and CompanyDiagramAuthoring use one shared portal hook. Their generated editor imports React and ReactDOM from the host instead of bundling another runtime; the generator binds their exact versions, lock integrity and package bytes.

Persistent actual-adapter proof: private `apps/company/scripts/test-company-studio-root.mjs`, CI-wired across Chrome, Firefox and WebKit. All three source integration runs pass one `createRoot` call through read-only and authoring mounts, open-menu disposal and remount; canonical toolbar/menu ancestry reaches the live Company context provider. The proof also verifies equal-content canvas/selection retention, keyboard geometry mutation, Delete/Cancel, palette state, Escape focus, revision panel release and removal of document keyboard listeners, with no browser errors or warnings. Evidence: `/private/tmp/studio-company-root-{chrome,firefox,webkit}.json`. Emitted declaration consumer typecheck passes; unchanged standalone host browser regression passes 11/11. Final exact candidate generation/consumer rerun remains required after the coordinated package freeze.
