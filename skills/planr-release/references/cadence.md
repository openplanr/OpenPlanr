# Cadence, hotfixes, and recovery

Contents:
1. Deploys are not releases
2. The Unreleased section
3. Picking a rhythm
4. Hotfixes
5. When a release goes out wrong
6. Freezes and quiet periods

---

## 1. Deploys are not releases

A deploy puts code in production. A release is a named, dated, described unit that users and support can refer to. Conflating them is what makes high-frequency shipping incompatible with meaningful versions.

Deploy continuously. Release on a rhythm. The version number then marks a point people can talk about ("this started in 2026.09.2") rather than incrementing invisibly forty times a week.

The one exception is a product whose users genuinely track every deploy, which in practice means developer tooling with a public build feed. Almost nothing else qualifies.

---

## 2. The Unreleased section

This is the mechanism that makes weekly releases cheap.

Keep this at the top of `CHANGELOG.md` at all times:

```markdown
## [Unreleased]

### Added
- Entry written when the work merged, while it was still fresh.
```

Append to it as work merges, in user-facing language, not commit language. Cutting a release then becomes: rename the heading to the version and date, open a fresh empty `## [Unreleased]`, tag.

The reason this is worth the discipline: reconstructing user intent from commit messages a week later is slow and lossy. The person who wrote the feature knows what it does for users on the day they merged it, and nobody knows it as well again.

If the section was not maintained, fall back to collecting from git plus the user's summary. Expect gaps and ask about them explicitly.

---

## 3. Picking a rhythm

**Daily releases.** Suits internal tools and early products with a small user base and fast feedback. CalVer `YYYY.MM.DD` fits naturally. Cost: notes get thin, and users tune out. Mitigate by skipping in-product announcements for most days and batching the announcement weekly even when the versions are daily.

**Weekly.** The default for most products. Cut on a fixed day, ideally Tuesday or Wednesday. Not Friday: nobody wants to discover a bad release on a Saturday, and the person who can fix it is unreachable. Not Monday: it forces weekend work to prepare.

**Twice weekly.** Works when feature flow is steady and fixes are frequent. Practical split: features on the fixed day, fixes whenever ready.

**Monthly or slower.** Only where consumers bear real upgrade cost, typically libraries and on-prem software. For a hosted product, monthly releases usually mean the notes go unread because too much accumulated.

Whatever the rhythm, keep the day fixed. Predictability is most of the value: support knows when to expect change, and users learn when to look.

---

## 4. Hotfixes

A hotfix is a fix that cannot wait for the next scheduled release because users are currently blocked or losing data.

Process:

1. Cut it as a patch off the current release, not off main, if main has unreleased work in it. Shipping unrelated half-finished changes alongside an urgent fix is how a small incident becomes a large one.
2. One line in the notes, describing the symptom.
3. Tag it. A hotfix that never gets a version number is invisible to support later, when someone asks whether a given user had the fix.

Do not batch hotfixes. The batching instinct is what turns a fifteen minute fix into a two hour release.

---

## 5. When a release goes out wrong

**Never delete or move a published tag.** Anything that consumed it will silently disagree with anything that consumes it later, and that class of bug is miserable to diagnose.

Instead:

- Roll forward with a new patch version wherever possible. It preserves the history and is faster than a rollback in most deployment setups.
- If the release must be pulled (a published package, a broken migration), publish a new version and mark the bad one deprecated through the registry's own mechanism. Add a changelog entry saying it was withdrawn and why. Users who already installed it need to know.
- Correct the changelog by adding a note, not by rewriting history. A changelog that gets quietly edited stops being evidence.

---

## 6. Freezes and quiet periods

Worth declaring in the profile if they apply:

- Around a launch, a demo, or a client-facing event, hold non-urgent releases. Fixes still ship.
- Around holidays, avoid shipping anything breaking when the people who would field the fallout are away.
- If the product serves businesses with their own peak periods, avoid their peak. A booking product should not ship a breaking change into a salon's Saturday.

A freeze is a schedule decision, not a code freeze. Work continues and accumulates in `Unreleased`.
