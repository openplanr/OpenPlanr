# Monorepo provenance — how the four repositories became one

> Recorded 2026-08-02 for BL-010. Read this before "fixing the inconsistency" in how
> history was handled — the inconsistency is deliberate and load-bearing.

## What happened

Four repositories became one at `openplanr/OpenPlanr`, which was **reused** as the monorepo
root rather than replaced by a new repository. Reuse preserves the stars, watchers, issue
history, inbound links and — critically — the npm provenance attestation that ties published
packages to this repository.

| Package | Source repository | Method | SHAs |
|---|---|---|---|
| `packages/OpenPlanr` | `openplanr/OpenPlanr` (host) | `git mv` into the subdirectory, one commit | **preserved** |
| `packages/planr-pipeline` | `openplanr/planr-pipeline` | `git filter-repo --to-subdirectory-filter packages/planr-pipeline --tag-rename ':legacy-pipeline-'` | rewritten |
| `packages/skills` | `openplanr/skills` | same, `packages/skills`, `--tag-rename ':legacy-skills-'` | rewritten |
| `packages/marketplace` | `openplanr/marketplace` | same, `packages/marketplace`, `--tag-rename ':legacy-marketplace-'` | rewritten |

## Why the asymmetry is deliberate

It looks like an inconsistency. It is a trade, made differently for the host than for the
others because the costs are not symmetric.

**The host was not filtered.** SHA stability *is* provenance for the repository that owns the
published `openplanr` package, the public documentation links, and a CHANGELOG full of commit
links. Rewriting those SHAs would invalidate every one of them to gain tidier historical
paths. The cost of the `git mv` is one rename commit; `git log --follow` and GitHub's "view
blame prior to this change" both traverse it, because it is a 100%-similarity rename.

**The other three were filtered.** They gain correct historical paths — `git log --follow
packages/planr-pipeline/<file>` reaches the first commit with no discontinuity — and lose
SHAs that were not load-bearing anywhere public. Their originals stay reachable forever.

**If you filter the host later to make it "consistent", you destroy the SHA stability this
choice exists to protect.** Don't.

## Recovering the originals

Every source repository carries a `pre-monorepo` tag pointing at its exact pre-merge commit:

```bash
git clone https://github.com/openplanr/planr-pipeline.git
git checkout pre-monorepo
```

Full-history bundles and tarballs of the untracked `.planr/` state were also captured before
the merge and verified with `git bundle verify`.

Each merge commit body records the source repository, its remote, the pre-merge SHA, and the
exact filter command used.

## Tags

The bare `vX.Y.Z` namespace is retired. It had real collisions: the host's `v0.3.0`–`v0.9.0`
matched planr-pipeline's identically, and ten of skills' tags matched the host's. Those were
**avoided rather than resolved** — all 132 inbound tags were renamed under `legacy-pipeline-`,
`legacy-skills-` and `legacy-marketplace-` prefixes, and none matches `v*`, so
`git describe --match 'v*'` can never select one.

Future tags are changesets-format (`openplanr@1.22.0`, `planr-pipeline@0.39.0`) and cannot
collide with anything historical.

## The mirrors are not archives

`openplanr/planr-pipeline`, `openplanr/skills` and `openplanr/marketplace` still exist and are
still updated. They are **read-only mirrors, and they are load-bearing**:
`/plugin marketplace add` resolves `.claude-plugin/marketplace.json` at a *repository root*,
and only one repository root can hold that path. Three plugin channels need three roots.

Do not archive, rename or delete them. See `docs/release-train.md` for how they are kept in
sync and how that sync is gated.
