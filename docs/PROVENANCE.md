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
