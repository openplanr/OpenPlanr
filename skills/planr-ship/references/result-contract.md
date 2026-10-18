# Ship result contract

Return one concise human rendering backed by these five machine fields:

1. `outcome`: `completed`, `partial`, or `blocked`, plus the achieved result.
2. `task`: exact task identity and path, or `direct-request`.
3. `changed`: material files grouped by purpose.
4. `checks`: each executed or applicable check with `passed`, `failed`, or
   `not-run` and a concise result.
5. `issues`: `blockers` for this task, each with problem, impact, and next
   action, and `findings` outside the task, shaped as `findings.md` describes;
   use `none` when both are empty.

Do not add receipts, digests, proof ledgers, fixed review loops, or approval
narration. Mention evidence only when it is the natural result of a command or
test the user needs to understand.

The chat summary is a concise view of these fields, not another machine
contract. Lead with the achieved behavior, group clickable changes by purpose,
and distinguish passed, failed and unexecuted checks. A completed change with
missing verification must say it is unverified. For partial or blocked work,
retain what succeeded and identify the blocker, impact and smallest recovery
step. Keep long file inventories and private diagnostics in the existing
results. Different wording or layout never triggers an execution or correction.
