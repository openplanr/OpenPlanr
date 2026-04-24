# Publishing a Release

For OpenPlanr maintainers. This repo's only published artifact is the skill itself — distributed as a Claude Code plugin marketplace entry, a Claude.ai zip upload, or via the Claude Skills API.

---

## Versioning

Version lives in `.claude-plugin/marketplace.json` under `metadata.version`. Follow semver:

- **Patch** (`1.0.0` → `1.0.1`) — wording fixes, typo corrections, troubleshooting additions.
- **Minor** (`1.0.0` → `1.1.0`) — new reference doc, new example, new workflow, new commands covered.
- **Major** (`1.0.0` → `2.0.0`) — breaking reorganization of `SKILL.md` structure or frontmatter, removal of triggers users rely on.

---

## Release checklist

1. **Verify CLI compatibility.** Confirm the latest `openplanr` CLI version on npm still matches what the skill documents. If the CLI has shipped new commands, flag them for the next minor bump.

2. **Run the activation suite.** Install the current `main` branch via Claude Code dev mode and run the 7 activation prompts and 4 non-activation prompts from `docs/INSTALL.md`. All must pass.

3. **Bump version.** Edit `.claude-plugin/marketplace.json` → `metadata.version`. Commit on `main`:

   ```bash
   git commit -am "Release v1.x.x"
   ```

4. **Tag and push.**

   ```bash
   git tag v1.x.x
   git push origin main --tags
   ```

5. **Create GitHub release.** Use `gh`:

   ```bash
   gh release create v1.x.x --title "v1.x.x" --notes-file RELEASE_NOTES.md
   ```

   Release notes should list user-facing changes in one-line bullets, grouped into **Added / Changed / Fixed**.

6. **Smoke-test the public install.** From a fresh checkout on a different machine (or a colleague's):

   ```
   /plugin marketplace add openplanr/skills
   /plugin install openplanr@openplanr-skills
   ```

   Verify the skill activates on at least one of the canonical prompts.

7. **Update the main OpenPlanr repo README** (if this is a major/minor bump) with the latest install instructions and a "Claude Skill" badge linking here.

8. **Announce.** In order of priority:
   - OpenPlanr Discord / community channel
   - Main OpenPlanr repo README
   - Twitter / LinkedIn post (optional, minor/major only)

---

## Hotfix flow

For urgent fixes (e.g. the skill stopped activating because the `description` regressed):

1. Branch `hotfix/v1.x.y` from the last release tag.
2. Cherry-pick or author the minimal fix.
3. Run the activation suite.
4. Bump patch version, tag, release.
5. Back-merge to `main`.

---

## Yanking a release

If a release breaks activation or produces bad output, yank it:

```bash
gh release delete v1.x.x
git push --delete origin v1.x.x
git tag -d v1.x.x
```

Then publish a patch release with the fix. Don't leave `main` in a broken state — Claude Code installs track the marketplace HEAD.

---

## Changelog convention

Maintain `CHANGELOG.md` at the repo root with one entry per release:

```markdown
## v1.0.1 — 2026-05-15

### Fixed
- `troubleshooting.md`: correct flag name in the "parent not found" fix

### Added
- Coverage of `planr linear push --as label-on:...`
```

User-facing language only; no "refactored internal section" entries.
