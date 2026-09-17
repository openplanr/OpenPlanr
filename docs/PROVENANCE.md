# Source provenance

The OpenPlanr monorepo is introduced by a normal consolidation commit descended
from the existing public CLI history. That commit imports a reviewed source
snapshot; it does not claim that all included code was newly authored at once
or by the consolidation author. Existing public releases, tags and attribution
remain intact. The earlier local root snapshot stays in recovery custody.

The following repositories and exact Git cutoffs identify the four source
lineages at consolidation. Versions describe those captured components, not a
new publication from this repository.

| Source repository | Captured component version | Git cutoff |
| --- | --- | --- |
| [openplanr](https://github.com/openplanr/OpenPlanr) | `1.25.3` | `a74466666d7550c1d5acc2baf8591da298c57991` |
| [planr-pipeline](https://github.com/openplanr/planr-pipeline) | `0.44.0` | `fa591a7e7157b47e10d33e4c30997925779c692e` |
| [@openplanr/skills](https://github.com/openplanr/skills) | `1.26.2` | `d052f6e2c78714d2092d78bd7f6dd7730b050938` |
| [openplanr-marketplace](https://github.com/openplanr/marketplace) | `1.14.0` | `c7ffa4de90d7bced11ba7bc21a8ce91ab379171e` |

The original repositories identify the detailed development and release histories.
Complete source and consolidation histories are also retained in private recovery
archives. The consolidation branch retains the existing public OpenPlanr ancestry and
tags. It does not import other source repositories’ private integration branches,
custody refs or planning records. A source cutoff describes the starting lineage; subsequent
integration changes are part of the snapshot.

Captured versions above identify source cutoffs, not future release targets.
The public packages `openplanr`, `planr-pipeline` and `@openplanr/protocol` use
independent Changesets versions; consolidation does not reset existing lineages. The hosted web application is maintained separately in
[openplanr/openplanr-web](https://github.com/openplanr/openplanr-web).

## Publication provenance

The first releases from this repository were versioned by commit
`74c45e2a683a4b7e96cb6472ed71e03099b9c35e` (`chore(release): version public packages`, #250).
Each published archive was rebuilt from that commit with `npm pack --ignore-scripts` and
compared file by file against the archive served by the registry; every file's SHA-256 matched.
The payload digest below is the SHA-256 of the sorted per-file SHA-256 list. Published versions are
immutable and are never republished; a correction is a new version.

| Package | Version | Published (UTC) | Channel | Build commit in attestation | Payload SHA-256 | Registry integrity |
| --- | --- | --- | --- | --- | --- | --- |
| `@openplanr/protocol` | `0.2.0` | 2026-09-17 00:09:37 | Outside `publish-packages.yml`; registry signature, no SLSA attestation | none | `908514e543aac2e65a017686f46806e89902243ae4b37235fc20c5dc09d0fad5` | `sha512-qaEB3Pyms/1qlepqKn2QdgUeKVlwGGCob4Tcd5ZlSxFGHAiIZKAfQLabnyMrUnmNT7PnWs8IjNWfOzNrK43bvw==` |
| `planr-pipeline` | `0.45.0` | 2026-09-17 00:17:51 | `publish-packages.yml` run 35165636890; SLSA v1 attestation | `8c05a49f5814dbac7d46e3e813e025e0d789b9f6` | `8af0841ca59f7e7d06d7971b1afc4b46f5d2bf12d65091a49c2f9390bd17b8a3` | `sha512-wxRiboEopbLrZxrIA5t4iAOw8k1lu/XVZZ3Uw37ppHhhnv3HP056RCqga7lbqntUL08MUMoMihJud7TD/i8P+w==` |
| `openplanr` | `2.0.0` | 2026-09-17 00:43:07 | `publish-packages.yml` run 35167294414; SLSA v1 attestation | `0bd38b4eeaa64f7a48a647611f859b2f408b6f22` | `69b80ada4072d2f73788b3ce587fd337eda7645601a6fcc68b76e9bf7e7376ad` | `sha512-C00jRt0+6Kpk5DHhmoFzuCiGF7MSJEEzUloGSEPVheMgESHLjjzY6UIwJMyEaKDrmyLteflDtW1XY+sYHf7iKw==` |
| `openplanr` | `2.0.1` | 2026-09-17 17:19:34 | `publish-packages.yml` run 35244051006; SLSA v1 attestation | `80456b17757221b952a394e4fe1987376774e468` | `3c4c730975a1785693ac90ecfc86ec26dc71c3badab556a9ef75c32c3bb2cd5d` | `sha512-FLt7nIEKhn2df0rCJh2Cl8LkKbrUmjPlCygcJTq/MZAhctEr0v1qR9KGLlJ66ELpIx3+fNYE9ZC9tmQYo2PZVw==` |
| `@openplanr/protocol` | `0.3.0` | 2026-09-17 20:10:48 | `publish-packages.yml` run 35268793491; SLSA v1 attestation | `745c3320ea8c26d52e786a11b891e7323f65809e` | `09ad63da2fe386f907419ec1ce0f4daef73123b1b7fa997455f70fd2d7a7b0e9` | `sha512-zz1KWf+6aOHSNGzinaiU1HsJIKKEPNxUQlLUKIn7EleIOJ7z3MOW7Aej7qMuZCHrBr0/HGkGn1cnWV1xOOLRBg==` |
| `planr-pipeline` | `0.45.1` | 2026-09-17 20:18:33 | `publish-packages.yml` run 35269463777; SLSA v1 attestation | `745c3320ea8c26d52e786a11b891e7323f65809e` | `5547524816047bf48f46e79db5e35dfe1ed63077f417f450afacf9ff7cb561b2` | `sha512-Gr4kPwseyIlPYYO2XaWofepOuUYJWHYpLJdZxKPGnSYmuBOAdLeeEhmAqBPTJEBq210rG4wp2otwGbK4GbUuOA==` |
| `openplanr` | `2.1.0` | 2026-09-17 20:25:46 | `publish-packages.yml` run 35270101679; SLSA v1 attestation | `745c3320ea8c26d52e786a11b891e7323f65809e` | `5585526e4ee8b51c3579bfb8a0288dcc8ec439da424f48dd7e85bb4587537b22` | `sha512-O5sdDMNJu4iTykfYG75xJTtDuoCxkS/wkP2aqcHIwdWQXGUsPbauP+we10NAG9avgYF5sIWPBIMs/z7sj7e54w==` |
| `openplanr` | `2.1.1` | 2026-09-17 21:20:10 | `publish-packages.yml` run 35275009599; SLSA v1 attestation | `b357aa171395d076312a8ce64c817cde2e99e137` | `d968d3ff3e059da523c22c54e69ad97f85a48ace00d0d7ace3cdc7aa6c77a60b` | `sha512-IRFpAMmMCIQg/TVzmJ+p/u8aD7rEg/YsHY7SIGpv36pEGdA+JAnbLNcBrtHqgQjs8nsTlsi9o21mmJG/b6v6Xw==` |

`@openplanr/protocol@0.2.0` reached the registry thirty seconds before its workflow dispatch
(run 35165457743) reached the publish step; the workflow found identical bytes and skipped. Its
bytes are proven against `74c45e2`, but it carries no build attestation. Every later version of
every package is published only through `publish-packages.yml`. The pipeline dispatch that
published `0.45.0` failed after publication in its registry-propagation check; #255 corrected
that check, and the re-dispatch (run 35167179994) confirmed identical bytes. The `openplanr@2.0.1`
run published successfully and then failed the same check because the registry took about eight
minutes to expose the version; the bytes were verified against the registry once visible.

Because all three payloads match `74c45e2`, the package-qualified tags `openplanr@2.0.0`,
`planr-pipeline@0.45.0` and `@openplanr/protocol@0.2.0` should point at that commit, and
`openplanr@2.0.1` at `80456b17757221b952a394e4fe1987376774e468`, whose rebuilt archive matched the
registry file for file. These four annotated tags and their GitHub releases were created on
2026-09-17 after that verification. The second release cycle — `@openplanr/protocol@0.3.0`,
`planr-pipeline@0.45.1` and `openplanr@2.1.0` — was versioned by `745c3320ea8c26d52e786a11b891e7323f65809e`
(#262), published in dependency order from that commit, rebuilt and compared file by file, and tagged
at that commit the same day; each run's registry-propagation check passed. `openplanr@2.1.1` was
versioned by `b357aa171395d076312a8ce64c817cde2e99e137` (#265), verified the same way and tagged there.

`planr-pipeline` versions `0.43.0` and `0.44.0` were internal release candidates that were never
published; the registry history runs `0.42.0` → `0.45.0`.

## License and attribution

OpenPlanr is founded and maintained by
[Asem Abdo](https://github.com/AsemDevs). Historical authorship remains attributable
to the source histories and retained notices. The root and captured source
licenses are MIT; the skills repository's captured manifest omitted a license
field, but its source includes an MIT `LICENSE` file. Existing component copyright
notices and license text are preserved, including notices naming OpenPlanr and
OpenPlanr Contributors. Third-party dependencies retain their respective licenses.

Refer to [LICENSE](../LICENSE), [CLI license](../packages/cli/LICENSE), and
[pipeline license](../packages/pipeline/LICENSE). Consolidation does not
replace or remove these obligations.

## Retained compatibility identifiers

Backlog and specification identifiers in CLI examples and synthetic fixtures are
part of the supported planning format. Historical component changelogs retain
their original release references. The closed Protocol 1.5 migration-manifest
schema retains its original repository constant for existing readers; it is not
the current repository destination. These compatibility records do not import
internal project plans or Git history.
