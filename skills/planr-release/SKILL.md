---
name: planr-release
description: Choose and maintain a product's versioning scheme, classify shipped changes, and write user-facing changelogs or release notes. Use for SemVer or CalVer decisions, version bumps, release cadence, and preparing a versioned release after landing.
license: MIT
---

# OpenPlanr Release

Classify what shipped by what users must do or expect differently, then say so in their language. This skill owns versioning and release communication after implementation; use `planr-land` for merge readiness and `planr-ship` for code.

## Do only the verb

| The user asks for | Do | Never, unless also asked |
|---|---|---|
| Release notes, a summary of what changed, or a proposed version | Steps 0 to 4 (Step 0 only reads). Return the notes and the proposed version in chat. | Write `CHANGELOG.md` or `.release/profile.md`, bump a version, run tests, tag |
| Prepare or cut a release | Steps 0 to 5 | Push, tag, publish, deploy |
| A tag, a publication or an announcement | That one external effect, after Step 5 is done | Anything else external |

A request for release notes or a proposed version changes no file, bumps no version and runs no tests, and never writes the profile.

## Step 0: Load the release profile

Read `.release/profile.md`, plus `AGENTS.md` and `CLAUDE.md` when tracked, in one batch. Expand only for a missing contract, a dependency or a contradiction, and stop when each claim has evidence or a named gap.

When the profile exists, follow it; do not re-argue the scheme. When it does not, propose a scheme and the bump in your answer from the recent tags and the public surface, and say the profile is missing; do not write it for a notes-only request. Choose a scheme and write a profile only on first-time setup, when the user asks to set one up, or when preparing the first release: read [the versioning schemes guide](references/schemes.md), get the user's agreement, then write it with the [release profile template](assets/profile-template.md).

## Step 1: Gather what shipped

These steps only read. Treat the output as evidence to classify, not as release notes. Run each git command on its own and check its exit status. A failure other than "no tag found" stops collection: report the command and its error text, and never read it as an empty window.

1. **Base.** If the user names a period ("this week", "since the 1st"), turn it into a date `YYYY-MM-DD` and use `--since=<date>` as the log range. Otherwise find the last tag with `git describe --tags --abbrev=0`, read its date with `git log -1 --format=%cs <tag>`, and use `<tag>..HEAD` as the range. With no tag at all, the window is all history: drop the range from the commands below. Record the base (`git rev-parse <tag>`, or the date) and the head (`git rev-parse HEAD`) in your return.
2. **Recent tags.** Run `git tag --list --sort=-creatordate` and keep the first five. Match their format when you tag.
3. **Commits.** Run `git log <range> --no-merges --pretty=format:'%h %s'`.
4. **Bodies and footers.** Run `git log <range> --no-merges --pretty=format:'--- %h%n%b'` and read every body. A `BREAKING CHANGE:` footer, or `!` after the type, makes the change Breaking whatever its subject says; a `Revert` subject and the change it reverts cancel out.
5. **Files touched, by area.** Run `git log <range> --name-only --pretty=format:`, drop blank lines, and reduce each path to its first two segments (`src/cli` for `src/cli/run.ts`; a top-level file stays as it is). Count the paths per area, sort by count, highest first, and keep the top 20.
6. **Merged PRs.** Only when pull-request context is useful, `gh` is installed and the window has a date (the user's date or the last tag's), run `gh pr list --state merged --search "merged:>=<date>" --limit 100 --json number,title`. If it fails, say so and suggest `gh auth status`; do not drop the section silently.
7. **Gaps.** Before finalizing, check whether this misses config or feature-flag changes, infrastructure, work from other repositories, or other user-visible behavior. Git cannot see these, so use any product summary in the request or repository; if material non-Git changes could alter the notes, ask one concise question.

## Step 2: Classify each change

For every unit of work ask: **does a user have to do, know, or expect something different now?** Code size does not matter; a one line default change can be breaking.

| Class | Test | Notes |
|---|---|---|
| Breaking | Someone must change something they configured, integrated or learned | Drives the largest bump, always announced |
| Feature | New capability a user can reach | |
| Improvement | Existing capability now better, faster or clearer | |
| Fix | A symptom users could hit is gone | |
| Security | Vulnerability closed | Ship alone and fast, describe impact not exploit |
| Deprecation | Still works, will be removed | Must state the removal target |
| Internal | Refactor, tests, CI, dep bumps, formatting | Affects the bump only if behavior moved |

Keep Internal work out of user-facing notes.

## Step 3: Decide the bump

Work the classification against the profile's scheme. SemVer: any Breaking change is MAJOR, a new compatible capability is MINOR, everything else PATCH. For hosted products, treat a change as breaking if a user's saved workflow, integration, bookmark or stored data stops working the way it did. CalVer: the number encodes time, so the notes lead with breaking changes. The [schemes guide](references/schemes.md) has the edge cases.

Under any scheme: one release, one version, never one per commit or deploy; a breaking change ships alone; and keep the existing tag format (a repository tagged `v1.2.0` must not get `1.3.0`).

## Step 4: Write the release notes

Read [the release notes guide](references/release-notes.md) before writing; it carries the voice rules and worked rewrites. Follow Keep a Changelog: a `## [version] - date` heading, then `### Removed`, `### Added`, `### Changed` and `### Fixed`, in the order that costs the reader most if missed (Removed and any breaking Changed first). Omit empty sections. One line per entry, led by what the user can now do, with fixes described by the symptom users saw.

## Step 5: Prepare the local release

Only when the user asks to prepare or cut a release.

1. Prepend the new section to `CHANGELOG.md` and open a fresh `## [Unreleased]`.
2. Bump version numbers with the repository's existing release tool, never by hand-editing duplicated numbers. Keep the operation local and untagged unless the user requested a tag. For npm, use `npm version --no-git-tag-version`; for independent JavaScript packages, prefer the repository's Changesets flow.
3. Run the repository's release checks. Confirm every release-note entry maps to shipped behavior and every user-visible change in the window is represented.
4. Push tags, publish packages, create hosted releases, post announcements, or deploy only when the user explicitly requests that external effect.

## Return

Lead with what was prepared locally or actually released; preparing notes or versions is not publication. Follow [the shared return rules](references/return-contract.md).

- **Version:** current and proposed versions, scheme, bump rationale, and the base and head revisions.
- **Included:** user-visible changes in the release window.
- **Notes:** the release-note text, or the changed changelog path when one was written.
- **Checks:** release verification performed and results, or `not run` for a notes-only request.
- **Next:** the one remaining local or external release action, or `none`.

## References

- [Versioning schemes](references/schemes.md): read on first setup or when asked to choose a scheme.
- [Release cadence and health](references/cadence.md): read for cadence, hotfixes, freezes, a bad release or a versioning health check.
- [Release notes](references/release-notes.md): voice rules and worked rewrites, read before writing notes.
- [Release profile template](assets/profile-template.md) and [changelog template](assets/changelog-template.md): read when writing either file.
