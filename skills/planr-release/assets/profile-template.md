# Release profile: <PRODUCT NAME>

Written on <DATE>. Update when the product's audience or surface changes,
not on every release.

## Scheme

**Scheme:** <SemVer | CalVer YYYY.MM.PATCH | other>
**Why:** <one or two sentences tying the choice to who reads the number and
what question they are asking>

## Public surface

The list of things a breaking change can happen to. Anything not listed here
can change in a patch.

- <e.g. documented HTTP endpoints under /api/v1>
- <e.g. webhook payload shapes>
- <e.g. the booking flow URLs users bookmark>
- <e.g. exported types from the package entrypoint>

## Second version line

**Applies:** <yes | no>
**If yes:** <what it covers, which scheme, where it is declared>

## Cadence

**Regular cut:** <e.g. weekly, Wednesday>
**Fixes:** <e.g. shipped immediately as patches>
**Breaking changes:** <e.g. announced 14 days ahead, shipped alone>
**Freezes:** <e.g. none | client demo weeks | December>

## Tooling

**Version bump:** <e.g. pnpm changeset version | npm version>
**Tag format:** <e.g. v1.4.0 | 2026.09.1>
**Changelog:** <path, e.g. CHANGELOG.md, Keep a Changelog format>

## Voice

**Audience:** <who reads the notes>
**Product vocabulary:** <UI terms that must be used verbatim, and the internal
names that must never appear>
**Channels:** <CHANGELOG.md | in-product what's new | email | GitHub releases>
