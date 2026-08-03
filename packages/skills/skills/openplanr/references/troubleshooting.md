# OpenPlanr Troubleshooting

Symptom → diagnosis → fix. Quick reference for agents to recover from common failures without human intervention.

---

## The command hangs and never returns

**Symptom:** Agent invokes a `planr` command and it sits forever with no output.

**Diagnosis:** You forgot `--yes`. OpenPlanr tries to render interactive prompts, which have no stdin in an agent context.

**Fix:** Re-run with `--yes` (or `--no-interactive`) appended. Every command listed in `commands.md` includes it. If the command uses `--manual`, remove that flag — manual mode requires a human.

---

## "AI provider not configured"

**Symptom:** AI-driven commands (`plan`, `epic create`, `task create`, `refine`, `backlog prioritize`, `estimate`) fail with a config error.

**Diagnosis:** `.planr/config.json` has no provider set, or `~/.planr/credentials.json` has no key for the selected provider.

**Fix:**

```bash
planr config set-provider anthropic
planr config set-key anthropic         # prompts for the key — ask the user
planr config set-model claude-sonnet-4-20250514
planr config show                      # verify
```

If the user has the key exported as `ANTHROPIC_API_KEY` in their shell, OpenPlanr will pick it up automatically — in that case only `set-provider` is needed. Confirm with `planr config show`.

---

## "API key missing"

**Symptom:** Provider is set but calls fail with 401 / "missing key".

**Fix:** Same as above — run `planr config set-key <provider>` and supply the key, or export the provider's environment variable (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`).

---

## "Parent not found" or broken cross-references

**Symptom:** Commands complain about missing parent links, or children reference a file that's gone.

**Diagnosis:** An artifact was renamed or deleted manually; cross-references are stale.

**Fix:**

```bash
planr sync --dry-run        # preview what will change
planr sync                  # apply repairs
```

This removes stale parent-child links, restores missing ones, and deduplicates. For a full audit, run `planr status` afterward.

---

## `planr: command not found`

**Symptom:** Bash can't find the `planr` binary.

**Diagnosis:** OpenPlanr is not installed globally.

**Fix:** Use `npx`:

```bash
npx openplanr@latest <command> --yes
```

Or install globally (once, with user consent):

```bash
npm i -g openplanr
```

---

## "Unsupported Node version" / import errors

**Symptom:** Commands fail immediately with ESM/import errors or an explicit version check.

**Diagnosis:** Node version < 20.

**Fix:** Upgrade Node:

```bash
node --version              # confirm < 20
# via nvm
nvm install 20 && nvm use 20
# or via Homebrew
brew upgrade node
```

---

## "Permission denied" writing `.planr/`

**Symptom:** File writes into `.planr/` fail with EACCES.

**Fix:** Check directory permissions — most commonly `.planr/` was created by `sudo npm ...` at some point. Reset ownership:

```bash
sudo chown -R "$(whoami):$(id -gn)" .planr
```

---

## AI returns low-quality or too-coarse output

**Symptom:** Generated epic/story/tasks are vague or miss key requirements.

**Fix:**

1. Use `--file <path>` with a detailed PRD instead of a short `--title`.
2. Run `planr refine <id> --yes` to iterate on a specific artifact.
3. For cascading improvement: `planr refine EPIC-001 --cascade --yes`.
4. Check the configured model — prefer Claude Sonnet 4 or GPT-4o over smaller models for planning quality.

---

## `planr plan` hit AI quota mid-cascade

**Symptom:** Epic and features generated, but stories or tasks failed.

**Fix:** Don't re-run `plan` — it won't skip existing artifacts. Resume at the specific step:

```bash
planr story create --epic EPIC-001 --yes      # resume at stories
planr task create --feature FEAT-001 --yes    # resume at tasks per feature
```

---

## `sprint create` says a sprint is already active

**Symptom:** Cannot create a new sprint.

**Diagnosis:** Only one sprint can be active at a time.

**Fix:**

```bash
planr sprint status           # check the active one
planr sprint close --yes      # archive it
planr sprint create --name "..." --duration 2w --yes
```

---

## `github push` fails with auth error

**Symptom:** GitHub sync commands fail.

**Fix:** The `gh` CLI must be installed and authenticated:

```bash
gh --version
gh auth status
gh auth login                 # if not logged in
```

---

## `linear push` fails with "team not configured"

**Symptom:** Linear commands can't find a team.

**Fix:**

```bash
planr linear init             # re-run, select a team
```

If the token is missing, set via credentials service (prompted) or export `PLANR_LINEAR_TOKEN`.

---

## `refine --cascade` edited too many files

**Symptom:** Cascade modified artifacts the user didn't expect.

**Fix:**

1. Before re-running, confirm the scope with the user.
2. Use git to review and selectively revert:
   ```bash
   git diff .planr/
   git checkout -- .planr/stories/US-XXX-*.md
   ```
3. Consider running `refine` without `--cascade` and targeting specific artifacts only.

---

## Skill is not activating in Claude Code

**Symptom:** Claude Code doesn't invoke this skill even for clearly matching planning requests.

**Fix:**

1. Verify the plugin is installed:
   ```
   /plugin
   ```
2. Check the skill is listed under the `openplanr` plugin.
3. Try a more explicit trigger: "use the openplanr skill to plan ..."
4. If still not activating, reinstall:
   ```
   /plugin marketplace add openplanr/skills
   /plugin install openplanr@openplanr-skills
   ```

---

## Generated `.planr/` directory is checked into git and polluting diffs

**Symptom:** Every run creates noisy diffs.

**Fix:** `.planr/` is designed to be checked in — it's your plan of record. But for noisy generated reports, gitignore the output directory:

```gitignore
.planr/reports/
```

Keep `epics/`, `features/`, `stories/`, `tasks/`, `quick/`, `backlog/`, `sprints/`, `adrs/`, and `config.json` under version control.
