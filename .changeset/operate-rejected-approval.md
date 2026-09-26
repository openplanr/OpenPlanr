---
'openplanr': patch
---

Recording a `rejected` or `deferred` Action approval through `operate.action.approve` now commits the decision and moves the Action to `rejected` or `deferred`. Previously the command failed with `STATE_TRANSITION_INVALID` ("operating-event: $ matched 0/57 branches") because the follow-up Action Event carried no reason, and the Action stayed `proposed`.
