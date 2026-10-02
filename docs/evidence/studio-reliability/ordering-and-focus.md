# Hosted state and editor focus regressions

The exact `fab1c6b9` candidate passed public CI and cold private adoption. A later
native hosted stress run passed 58 of 60 attempts and exposed two genuine
prototype-state losses. Earlier passing suites remain predecessor evidence;
they do not certify the corrected candidate or hosted release.

## Editor menu focus

Opening the diagram's More menu could focus a disabled or CSS-hidden item. On
native WebKit this left focus on the document body, so Escape did not close the
menu and the menu intercepted a later Revisions click. A second reproduction
showed ArrowUp selecting the wrong item after the focused choice became disabled.

The menu now selects rendered, operable choices using the item's owning document.
Click and arrow opening share that selection. Changed eligibility chooses the
appropriate first or last item, an empty menu returns focus to its trigger, and
closing restores the connected More button. Canvas and host keyboard ownership
are unchanged.

The independent source review and native edge probes passed in Chromium, Firefox
and WebKit. After adoption, the complete editor-host suite passed 15 tests per
engine: Google Chrome in 17.972 seconds, Firefox in 21.448 seconds and WebKit in
11.038 seconds. The four focused unit regressions also passed. Recorded source,
compiled module, stylesheet, manifest and lock hashes stayed unchanged during
the native runs.

One original WebKit suite attempt retained a host-controls Tab failure. A native
diagnostic reproduced ordinary Tab skipping plain buttons on both the hosted
page and a bare page without an editor; the editor did not prevent the key.
Native Option-Tab reached the host button and then the open drawer. The test now
uses that macOS WebKit shortcut, as the existing Studio contrast test does;
other platforms retain Tab. Both original focus assertions and deadlines remain.
The failed run is retained separately from the subsequent complete passing run.

## Prototype state

Passive native traces showed a queued empty restore arriving after a newer local
input. That restore replaced the local snapshot, and the next captured update
then replaced the host's shared snapshot. Waiting longer for a test assertion
would not recover the lost value.

The correction is under independent data-integrity review. Review includes input
before the first configured legacy-field restore, explicit reset, view recreation,
message ordering, bounded metadata and compatibility with older bootstraps.
Final owning generation, repository regressions, successful packed CI and fresh
private adoption remain required before the corrected candidate is accepted.

No test uses customer content. Native diagnostics and temporary source-overlay
checks are distinguished from a successful packaged consumer journey. The legacy
room expiry transition and service deployment remain separate acceptance steps.
