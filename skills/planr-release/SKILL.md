---
name: planr-release
description: Choose and maintain a product's versioning scheme, classify shipped changes, and write user-facing changelogs or release notes. Use for SemVer or CalVer decisions, version bumps, release cadence, and preparing a versioned release after landing.
license: MIT
---

# Planr Release

Two jobs: pick the right version number, and tell users what changed in language they care about. Both fall out of correctly classifying what shipped, so classification comes first and everything else follows from it.

The failure mode this skill exists to prevent: version numbers chosen by gut feeling or diff size, and changelogs that read like a git log. Both make releases untrustworthy to the people downstream of them.

This skill owns versioning and release communication after implementation. Use
`planr-land` for merge readiness and landing order, and `planr-ship` for code
implementation. Do not turn a release request into a new implementation pass.

## Step 0: Load the release profile

Look for `.release/profile.md` at the repo root. It records the scheme, cadence, public surface and voice already chosen for this product.

If it exists, read it and follow it. Do not re-argue the scheme on every release. Re-deciding is how version histories become incoherent, and the whole value of a version number is that it means the same thing this month as it did last month.

If it does not exist, this is first-time setup. Work through Step 3, propose a profile, get the user's agreement, then write it using the [release profile template](assets/profile-template.md). Every later release starts from that file instead of from scratch.

## Step 1: Gather what shipped

Establish the window first. Default is "since the last release":

```bash
git describe --tags --abbrev=0          # last tag
git log $(git describe --tags --abbrev=0)..HEAD --oneline --no-merges
```

If the user names a period instead ("this week", "since the 1st"), use the
matching date window. The [change collector](scripts/collect_changes.sh) gathers local Git evidence in
one pass. Pass `--include-prs` only when remote pull-request context is useful
and available.

Pull from all three sources, since each catches things the others miss:

1. **Commits and tags.** The complete record of code change, and the noisiest.
2. **Merged PRs and branch names.** Better titles than commits, and they group related commits into one user-visible unit. `gh pr list --state merged --search "merged:>=YYYY-MM-DD"` when the `gh` CLI is available.
3. **The user's own summary.** Authoritative for anything git cannot see: infra changes, config and feature flags, third-party integrations, work shipped from another repo, and which of the twelve commits behind a feature actually matter to users.

Use any product summary already present in the request or repository. If material
non-Git changes could alter the release notes, ask one concise question about
what Git missed before finalizing.

## Step 2: Classify each change

For every unit of work, ask one question: **does a user have to do, know, or expect something different now?** Not "how much code moved". A 2000 line refactor with identical behavior is invisible. A one line default change can be breaking.

| Class | Test | Notes |
|---|---|---|
| Breaking | Someone must change something they configured, integrated or learned | Drives the largest bump, always announced |
| Feature | New capability a user can reach | |
| Improvement | Existing capability now better, faster or clearer | |
| Fix | A symptom users could hit is gone | |
| Security | Vulnerability closed | Ship alone and fast, describe impact not exploit |
| Deprecation | Still works, will be removed | Must state the removal target |
| Internal | Refactor, tests, CI, dep bumps, formatting | Affects the bump only if behavior moved |

Internal work is real work and still does not belong in user-facing notes. Keep it out. Empty sections beat padded ones.

## Step 3: Choose the scheme (first time only)

Pick per product and state the reasoning in one or two sentences. Read the [versioning schemes guide](references/schemes.md) for the full decision guide, edge cases and the multi-line setup. The short version:

- **Library, SDK, CLI or anything others install and pin** to SemVer, strictly. The declared public API is the contract, and consumers automate against the number.
- **Hosted app with no external integrators** to CalVer. Nobody pins a version they cannot choose, so the number's real job is answering "how old is this", which a date does better than a counter.
- **Hosted app that also exposes an API, webhooks or an SDK** to two version lines: SemVer on the API surface, CalVer or SemVer on the app itself. Conflating them forces an app redesign to look like an API break.
- **Internal tool** to CalVer. Low ceremony, and the deploy date is the thing people actually ask about.

Record the choice, the reasoning and the declared public surface in the profile. "Public surface" is the most important field: it is the list of things a break can happen to, and without it "breaking" has no meaning.

## Step 4: Decide the bump

Work the classification against the scheme.

**SemVer**, where MAJOR/MINOR/PATCH map to compatibility:

- MAJOR: anything in the Breaking row above. Removal of a documented feature, changed response shape, changed default that alters outcomes, tightened validation that rejects previously accepted input, renamed config, new required field.
- MINOR: new capability, backward compatible. Also the release that first ships a deprecation warning.
- PATCH: fixes, performance, copy, visual polish, dependency updates with no behavior change.

For hosted products, SemVer's definition of breaking needs translating, because there is no compilation step to fail. Treat it as breaking if a user's saved workflow, integration, bookmark, muscle memory or stored data stops working the way it did. Moving a primary action to a different screen is a change users must relearn, and pretending otherwise is how "we never make breaking changes" becomes false.

**CalVer** (`YYYY.MM.PATCH` or `YYYY.MM.DD`), where the number encodes time, not compatibility. The counter carries no compatibility signal, so breaking changes must be carried by the notes instead. Lead with them and never bury them.

Two rules that hold under any scheme:

- One release, one version. At daily or weekly cadence, do not bump per commit or per deploy. A version number that increments forty times a week communicates nothing.
- Never bundle a breaking change with unrelated work. It ships alone so the notes and the rollback are both about one thing.

## Step 5: Cadence

The mechanism that makes frequent shipping compatible with meaningful versions is separating **deploys** from **releases**. Deploy whenever the work is ready. Cut versions on a rhythm.

Keep a rolling `## [Unreleased]` section at the top of `CHANGELOG.md` and append to it as work merges, while the context is fresh. Cutting a release then means renaming that section to the version and date, and opening a fresh empty one. This is what makes weekly releases take five minutes instead of an hour of git archaeology.

Default rhythm for a daily-to-weekly product:

- Fixes that unblock users: cut immediately as a patch. Do not make people wait for Friday.
- Features and improvements: accumulate into the regular cut, weekly or twice weekly.
- Breaking changes: announced ahead, shipped alone, on a date users were told about.

See the [release cadence guide](references/cadence.md) for the hotfix path, release freezes, and what to do when a release goes out wrong.

## Step 6: Write the release notes

Read the [release notes guide](references/release-notes.md) before writing. It carries the voice rules and worked rewrites; a summary here would produce notes that read like a commit log, which is the exact thing being avoided.

The shape, following Keep a Changelog:

```markdown
## [1.4.0] - 2026-09-08

### Removed
- Entry, with the migration step inline.

### Added
- Entry.

### Changed
- Entry.

### Fixed
- Entry.
```

Order sections by what costs the reader most if missed: Removed and any breaking Changed first, then Added, then the rest. Omit empty sections entirely.

Core rules, expanded in the reference:

- Lead with what the user can now do, not with what was built.
- Name features exactly as they appear in the product UI.
- Describe fixes by the symptom users saw, not the cause in code.
- One line per entry. If it needs a paragraph, it needs a linked doc.
- No em dashes, no filler openers, no "we're excited to announce".

## Step 7: Prepare the local release

1. Prepend the new section to `CHANGELOG.md` and open a fresh `## [Unreleased]`.
2. Bump version numbers with the repository's existing release tool, never by
   hand-editing duplicated numbers. Keep the operation local and untagged unless
   the user requested a tag. For npm, use `npm version --no-git-tag-version`;
   for independent JavaScript packages, prefer the repository's Changesets flow.
3. Inspect recent tags and preserve the established tag format. A repository
   tagged `v1.2.0` must not suddenly get `1.3.0`.
4. Run the repository's release checks. Confirm every release-note entry maps to
   shipped behavior and every user-visible change in the selected window is
   represented.
5. Push tags, publish packages, create hosted releases, post announcements, or
   deploy only when the user explicitly requests that external effect.

## Return

- **Version:** current and proposed versions, scheme, and bump rationale.
- **Included:** user-visible changes in the release window.
- **Notes:** the release-note text or changed changelog path.
- **Checks:** release verification performed and results.
- **Next:** the one remaining local or external release action, or `none`.

## Long-term health

Every few months, or when the user asks whether versioning is working:

- **Drift check.** Do the tag, the manifest and what is deployed agree.
- **Deprecation hygiene.** Every deprecation announced needs a stated removal target and eventual follow-through. Deprecations that never get removed teach users to ignore them.
- **Stuck at 0.x.** A product with real paying users on `0.x` is signalling instability it does not have. Cutting 1.0 is a decision about the public surface being stable enough to promise, not about feature completeness.
- **Scheme fit.** A product that grew an API since the profile was written probably needs a second version line now.

## Reference files

- [Versioning schemes](references/schemes.md): full scheme selection guide, multi-line versioning, monorepo handling
- [Release notes](references/release-notes.md): voice rules, worked rewrites, per-channel formats
- [Release cadence](references/cadence.md): release rhythms, hotfixes, freezes, bad releases
- [Release profile template](assets/profile-template.md): the `.release/profile.md` written during setup
- [Changelog template](assets/changelog-template.md): starting `CHANGELOG.md`
- [Change collector](scripts/collect_changes.sh): gathers commits, optional merged PRs, and tag information for a window
