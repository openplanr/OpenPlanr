# Claude plugin outcome evals

Cases that measure what the plugin changes in the work itself, not which skill fires. Each case runs the
same prompt, fixture, tools and limits twice, with the plugin and without it
(`claude plugin eval --ablation with-without`). The explicit variants run with the plugin only.

| Case | Kind | Prompt | Scored by |
|---|---|---|---|
| `spec-from-vague` | scored | Turn two customer emails into something to build | judge |
| `plan-from-spec` | scored | Break an accepted spec into work | judge |
| `bug-investigate-fix` | guard | Due dates show a day early; find out why and fix it | hidden tests, judge |
| `ship-accepted-change` | guard | Implement an accepted change | hidden tests |
| `plan-review` | scored | Review a draft plan with eight seeded defects and four sound decoys | revocation named, judge |
| `branch-ready-to-merge` | scored | Is this branch ready to merge? (eight seeded defects, three decoys) | judge, no push or merge |
| `operate-review` | scored | Leadership review over metrics, incidents, accounts, roadmap, runway and contracts (six problems, two red herrings) | activation number cited, judge |
| `release-notes` | scored | Release notes since `v1.4.0` and the next version | `2.0.0` check, export removal listed, judge |
| `chain-spec-plan-ship` | scored | Decide, plan and build due-date reminders | hidden tests, judge |
| `*-explicit` | routing loss | Cases 1, 5 and 8 with the skill invoked by name | same as the base case |

Guards are expected near ceiling in both arms and stay out of the headline delta. Every case is also scored on
the no-unrequested-changes guard (`scope.json`).

## Case folder

- `case.yaml`, `prompt.md`: the CLI case. The prompt body is what a person would type. `tags: [guard]`
  marks the guard cases.
- `scaffold.sh`: builds a deterministic git repository (fixed author and dates, no network) on the shared
  notes app in `_shared/notes-base.sh`, then sources `_shared/probe.sh`. The probe writes
  `.git/info/eval-probe.json` with booleans and counts only, including `hiddenReadable` and
  `gradersReadable` when the runner sets `EVAL_HIDDEN_DIR` and `EVAL_GRADERS_DIR`, and `gitWorks`
  (`git --version` exits 0). `release-notes/selftest/probe-git-unusable.json` is a probe with `gitWorks`
  false, which the runner treats as invalid.
- `graders/`: free CLI checks only. `arm: with-only` graders are indicators (the skill fired) and are never
  scored; a grader whose name starts with `format-` is a format check; the rest are outcome checks. Trace
  regexes that look for the agent's own words match only assistant events (`^(?=.*"type":"assistant")` with
  the `m` flag), so fixture text returned by a tool cannot satisfy them.
- `judge.yaml`: criteria for the runner's blind judge, each one condition, tagged `outcome` (follows from the
  prompt or a reasonable user's ask) or `format` (follows from a template). `facts` gives the judge what it
  needs to know about the fixture. In the review cases each seeded defect and each decoy is one outcome
  criterion with `tag: defect` or `tag: decoy`; a decoy criterion passes when the output does not call the
  sound item a blocker. A variant's `judge.yaml` inherits its base case.
- `scope.json`: `{requestedPaths, allowedCommands}` for the guard. A run passes when every changed path
  matches a `requestedPaths` glob and its Bash calls run none of `git tag`, `git commit`, `git push` or
  `npm version` unless `allowedCommands` names it. Listing tags and printing the version do not count.
  Runner-only: never staged or shown to the judge. A variant carries a copy of its base case's file.
  `breakpoints` lists 1 to 3 order assertions, reported beside the outcome and never scored:
  `{ name, before: { tool, input? }, after: { tool, input? } | "absent", gate? }`. `tool` is a name or a
  list of names (`final_message` is the closing message); `input` is a regex over the call's JSON input.
  With `after: "absent"`, any `before` call fails it. Otherwise the gated action is the first `after` call
  (gate `after`, the default), which a `before` call must precede, or the last `before` call
  (gate `before`), which an `after` call must follow; with no gated action the result is n/a.
  `selftest/breakpoints.json` holds traces that violate each assertion once and one with no gated action.
- `hidden/` (cases with hidden tests): `*.test.js` and `scope.json`
  (`{testCommand, testDir, allowedPaths}`). The runner copies the tests into `test/hidden/` after the run and
  runs `node --test`. Diff scope against `allowedPaths` is reported, not scored.
- `selftest/`: hand-made outputs, never shown to a run. The four core outputs are `good-planr`, `good-plain`,
  `bad-planr` and `bad-plain`, each with `files/` laid over the scaffolded workspace, `last-message.md` and
  `run.json` (tool calls for a synthetic trace, plus any judge criteria a bad output is expected to pass).
  Flawed outputs name a good `base` in `run.json` and add only what breaks it, listed in `fails`:
  `bad-edit-plain` (every case) bumps the version without being asked, and `bad-decoy-planr` (cases with
  decoys) blocks one decoy. `expect.json` holds the expected hidden-test, guard, free-grader and judge
  verdicts, written by `--write-expect` and checked for drift. The outputs hold planning-tool-style text on
  purpose.
- `branch-ready-to-merge/tools/gh`: offline stand-in for the GitHub CLI, with the `gh pr view --json` field
  list recorded from gh 2.95.0.

## Checks

```bash
node scripts/skills/check-outcome-evals.mjs
node --test tests/skill-evals/outcome-evals.test.mjs
```

The static check fails if a prompt body, scaffold, workspace (files, commit messages, refs, git config,
probe output), hidden test, judge file, `gh` stand-in or scored grader names the plugin, a skill or an agent.
Only `with-only` indicators may match `planr:` skill names. It also checks the case, prompt, grader, judge
and scope shapes.

The self-test runs the guard, every free grader and the hidden tests against each output: outcome checks must
pass the good outputs and fail the bad ones (a flawed output fails only what it lists, and the guard and decoys
pass unless listed), and format checks and indicators must pass the plugin-style outputs
and fail the plain ones, so format bias shows up per grader. Judge criteria get the same expectations and are
checked against a real judge in the pilot. Neither check calls a model.
