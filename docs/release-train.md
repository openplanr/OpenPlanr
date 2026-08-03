# Release train

> How a change becomes a published package and a live plugin. See
> [ADR-013](../packages/planr-pipeline/docs/adrs/ADR-013-monorepo-independent-versions.md)
> for why versions are independent, and [monorepo-provenance.md](./monorepo-provenance.md)
> for why the mirror repositories still exist.

## The four packages

| Package | npm | Published? | Distribution |
|---|---|---|---|
| `packages/OpenPlanr` | `openplanr` | yes, public | npm (`planr`, `opr` bins) |
| `packages/planr-pipeline` | `planr-pipeline` | yes, public | npm + `/plugin install planr-pipeline@openplanr` |
| `packages/skills` | `@openplanr/skills` | **no**, `private: true` | `/plugin marketplace add openplanr/skills` |
| `packages/marketplace` | `openplanr-marketplace` | **no**, `private: true` | `/plugin marketplace add openplanr/marketplace` |

Two packages ship via npm. All three plugin channels ship via **git mirrors**, not npm —
which is why `skills` and `marketplace` being unpublished does not make them unreleased.

## Adding a change

```bash
npx changeset            # pick packages, pick bump, write the summary
```

Every user-visible change needs one, including changes to `skills` and `marketplace`. Those
two are `private: true` but are configured with `privatePackages: { version: true, tag: true }`,
so changesets versions **and tags** them.

That `tag: true` is load-bearing. The default is `false`, and with it the mirror workflow —
which is tag-gated — would never fire for a skills-only or marketplace-only change. Their
plugin channels would silently stop receiving updates, with no failing check anywhere.

## What a release does

Merging the changesets "Version Packages" PR triggers `release.yml`:

1. `changeset version` bumps each changed package and rewrites its CHANGELOG.
2. `node scripts/sync-ecosystem.mjs` regenerates **every** cross-package pin from the four
   `package.json` files — the marketplace manifest, `ecosystem.json`, the README table, the
   compatibility matrix, the protocol README, `input/tech/stack.md`. Pins are never
   hand-edited; `check:ecosystem` fails the build if they drift.
3. `npm install --package-lock-only` refreshes the single root lockfile.
4. `changeset publish` publishes the public packages and pushes tags.
5. `mirror.yml` fires on those tags and pushes each package subtree to its mirror.

**Ordering matters: npm first, mirrors second.** A mirror advertising a plugin version that
npm cannot yet resolve is a broken install for anyone who happens to update in between.

## Mirrors

Each mirror receives the *contents* of its package directory at the repository root, so
`.claude-plugin/marketplace.json` lands where `/plugin marketplace add` looks for it.

The push is **content-hash gated**: if the subtree hash is unchanged, nothing is pushed. This
is why the read-only banner lives in the package's `README.md` in the monorepo rather than
being injected at mirror time — injection would change the content on every push and defeat
the gate.

`version-drift.yml` includes a `mirror-freshness` check, because a mirror that quietly stops
updating produces no failure on its own. That was the single fatal flaw found in review of
the original merge plan: the tag gate plus the changesets default would have left two of the
three plugin channels with no trigger at all.

## Gates

| Gate | What it protects |
|---|---|
| `npm run check:ecosystem` | every generated version pin |
| `npm run check:cross-refs` | `SKILL.md`'s inlined frontmatter vs the canonical JSON Schemas |
| `npm run check:agent-divergence` | vendored Cursor agent templates — fails on *new* drift only |
| `cd packages/planr-pipeline && npm run doctor -- --strict` | ecosystem health |
| `npm run ecosystem:conformance -- --strict` | CLI graph output vs pipeline fixtures |
| `mirror-freshness` | mirrors actually received the last release |

Run them all locally with `npm run check:drift` from the repository root.

## First release from the monorepo

Deliberately boring: one patch changeset per publishable package with no functional content,
published to the `next` dist-tag first, smoke-tested on a clean machine, then promoted. The
first publish should exercise the *pipeline*, not the product, so that a failure is
unambiguously a pipeline failure — and `changeset publish` is irreversible (no unpublish after
72 hours, no version reuse).
