---
'openplanr': patch
---

The delegate skill no longer ships its previous integration path, which copied the checkout and wrote each changed file back itself. New runs already use the run branch handoff. Runs prepared before that change still finish with the helper they started with.
