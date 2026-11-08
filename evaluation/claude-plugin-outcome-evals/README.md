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
| `plan-review` | scored | Review a draft plan with four seeded defects and two sound tasks | judge |
| `branch-ready-to-merge` | scored | Is this branch ready to merge? (three seeded defects) | judge, no push or merge |
| `operate-review` | scored | Leadership review over metrics, incidents, roadmap and runway | judge |
| `release-notes` | scored | Release notes since `v1.4.0` and the next version | `2.0.0` check, judge |
| `chain-spec-plan-ship` | scored | Decide, plan and build due-date reminders | hidden tests, judge |
| `*-explicit` | routing loss | Cases 1, 5 and 8 with the skill invoked by name | same as the base case |

Guards are expected near ceiling in both arms and stay out of the headline delta.

## Case folder

- `case.yaml`, `prompt.md`: the CLI case. The prompt body is what a person would type. `tags` names the
  tool-grant group (`grant-bash-edit-write`) and marks guards (`guard`).
- `scaffold.sh`: builds a deterministic git repository (fixed author and dates, no network) on the shared
  notes app in `_shared/notes-base.sh`, then sources `_shared/probe.sh`. The probe writes
  `.git/info/eval-probe.json` with booleans and counts only.
- `graders/`: free CLI checks only. `arm: with-only` graders are indicators (the skill fired) and are never
  scored; a grader whose name starts with `format-` is a format check; the rest are outcome checks.
- `judge.yaml`: criteria for the runner's blind judge, each one condition, tagged `outcome` (follows from the
  prompt or a reasonable user's ask) or `format` (follows from a template). `facts` gives the judge what it
  needs to know about the fixture. A variant's `judge.yaml` inherits its base case.
- `hidden/` (cases with hidden tests): `*.test.js` and `scope.json`
  (`{testCommand, testDir, allowedPaths}`). The runner copies the tests into `test/hidden/` after the run and
  runs `node --test`. Diff scope against `allowedPaths` is reported, not scored.
- `selftest/`: four hand-made outputs (`good-planr`, `good-plain`, `bad-planr`, `bad-plain`), each with
  `files/` laid over the scaffolded workspace, `last-message.md` and `run.json` (tool calls for a synthetic
  trace, plus any judge criteria a bad output is expected to pass) and `expect.json` (the expected hidden-test,
  free-grader and judge verdicts, written by `--write-expect` and checked for drift). These hold planning-tool-style output on
  purpose and are never shown to a run.
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

The self-test runs every free grader and the hidden tests against the four outputs: outcome checks must pass
the good outputs and fail the bad ones, and format checks and indicators must pass the plugin-style outputs
and fail the plain ones, so format bias shows up per grader. Judge criteria get the same expectations and are
checked against a real judge in the pilot. Neither check calls a model.
