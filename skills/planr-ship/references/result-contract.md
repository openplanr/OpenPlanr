# Ship result contract

Return one concise human rendering backed by these five machine fields:

1. `outcome`: `completed`, `partial`, `blocked`, or `awaiting-acceptance` (repository
   work done; acceptance needs a run only the owner can do), plus the achieved result.
2. `task`: exact task identity and path, or `direct-request`.
3. `changed`: material files grouped by purpose; files outside the task's Create
   and Modify lists form their own group.
4. `checks`: each executed or applicable check with `passed`, `failed`, or
   `not-run`, a concise result, and the acceptance IDs it covers. The result says
   what fail-first proved, for example `failed before the change on an assertion;
   seed in src/x.ts caught`.
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
