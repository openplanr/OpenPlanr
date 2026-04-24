# Contributing to the OpenPlanr Skill

Thanks for your interest in improving the skill. This repo is small — the "code" is markdown instructions — so contributions are mostly wording, coverage, and testing changes.

---

## Ground rules

- **The skill is instruction-only.** We do not wrap CLI commands in shell scripts (the agent can call `planr` directly via bash). We do not reimplement CLI logic here. Changes to CLI behavior belong in the [CLI repo](https://github.com/openplanr/openplanr).
- **Triggers drive activation.** The `description` field in `SKILL.md` frontmatter is the sole signal Claude uses to decide whether to activate the skill. Changes to it must be tested against the activation prompts in `docs/INSTALL.md`.
- **Keep `SKILL.md` tight.** Target 100–300 lines. Heavier content belongs in `references/` (loaded on demand) or `examples/`.

---

## Proposing a change to `SKILL.md`

1. Fork and branch.
2. Edit `skills/openplanr/SKILL.md`.
3. Include in your PR description:
   - **Before/after agent behavior** — what trigger or workflow changes?
   - **Test prompts** — at least three prompts the skill must still activate on, and at least two it must still NOT activate on.
   - **Manual verification** — how you tested locally (Claude Code plugin dev mode or Claude.ai upload).

---

## Adding a new reference doc

References live in `skills/openplanr/references/` and are loaded by Claude on demand. Good reasons to add a new one:

- A new major CLI subcommand shipped and needs dedicated coverage.
- A recurring failure mode needs a troubleshooting section.
- A pattern keeps surfacing in workflows that's distinct from the existing seven.

Rules:

- **Link from `SKILL.md`.** If nothing in `SKILL.md` references the new doc, Claude won't load it.
- **Match the existing filename convention** — lowercase-hyphenated, `.md` extension.
- **Keep it skimmable** — headers every ~30 lines, tables for flag references, bullet lists for sequential steps.

---

## Adding a new example

Examples live in `skills/openplanr/examples/`. Each example must:

- Present a realistic, generic scenario (no proprietary info, no real user data).
- Show the exact commands the agent runs, in order, with `--yes` flags.
- Show expected output or artifact structure.
- Show how the agent summarizes the result to the user.
- Link from `SKILL.md` under the `## Examples` section.

---

## Testing changes locally

### Claude Code dev mode

```bash
# From the repo root:
/plugin marketplace add file:///absolute/path/to/openplanr-skills
/plugin install openplanr@openplanr-skills
```

Make edits, then reload the plugin (restart Claude Code or use `/plugin reload` if available).

### Claude.ai

Repackage the skill folder:

```bash
cd skills/openplanr && zip -r ../../openplanr-skill.zip .
```

Re-upload via Settings → Skills.

### Activation regression suite

Before submitting, run the 7 activation prompts and 4 non-activation prompts from PRD §14.2 / `docs/INSTALL.md`'s sanity-check section. All 7 must activate; none of the 4 must.

---

## Filing a bug

[Open an issue](https://github.com/openplanr/skills/issues) with:

- The environment (Claude Code version / Claude.ai plan / API SDK version).
- The prompt you sent.
- What the skill did (or didn't) do.
- What you expected.
- Relevant CLI output if the command was executed and failed.

---

## Release process

Maintainers should follow [`docs/PUBLISHING.md`](./PUBLISHING.md) when cutting a release.

---

## Code of conduct

Be kind, be specific, and assume good faith. Disagreements about wording or scope are fine — bring test prompts and the conversation resolves itself.
