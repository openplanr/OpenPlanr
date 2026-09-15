# OpenPlanr

OpenPlanr helps engineering teams understand systems, plan changes, review designs
and diagrams, and deliver work with evidence. It combines host-native agent skills,
a deterministic CLI, portable project formats, and local review studios.

Founded and maintained by **[Asem Abdo](https://github.com/AsemDevs)**.
The canonical product repository is **[openplanr/OpenPlanr](https://github.com/openplanr/OpenPlanr)**.

## What you can do

- Turn a product request into a specification, stories, and implementation tasks.
- Create and review diagrams, design screens, and interactive artifacts.
- Inspect repository planning and operating-review evidence in a local dashboard.
- Use the active agent host for reasoning and implementation; use the CLI for
  deterministic validation, rendering, synchronization, and project storage.
- Keep accepted repository content in Git and `.planr` files.

The hosted company workspace is **under development** in a separate web repository.
It provides selected artifact sharing, team review and proposed changes in
isolated staging. The release direction includes reviewed changes
back to local repositories. This snapshot does not establish enterprise general
availability, service-level guarantees, or compliance certification. Existing
encrypted token shares have a separate access model.

## Build from source

Use Node.js 24 for contributor work, Git, and npm. The package engine minimum is
Node.js 20; the CI configuration also includes Node.js 20 and 22 compatibility
checks. Use the repository lockfile and run commands from the root:

```bash
git clone https://github.com/openplanr/OpenPlanr.git
cd OpenPlanr
npm ci
npm run generate
npm run build
npm run test:focused
```

The public packages are `openplanr`, `planr-pipeline` and
`@openplanr/protocol`, with independent versions recorded in their manifests.
Protocol package versions are separate from schema/document versions.
A source snapshot does not imply that its changes have been published to npm.

After building, use the checkout's CLI without changing a global installation:

```bash
./node_modules/.bin/planr --help
./node_modules/.bin/planr --version
```

See [Contributing](CONTRIBUTING.md) for full verification and generated-source rules.

## Use OpenPlanr in a project

Install the generated skills into a supported host using the setup preview. For
example, from the OpenPlanr checkout:

```bash
./node_modules/.bin/planr setup --runtime claude --scope user --dry-run --json
./node_modules/.bin/planr setup --runtime claude --scope user --yes
```

Use `planr setup --help` for other hosts and scopes. Restart the host after changing
installed skills so a new session loads the current catalog. Host plugin
namespaces determine invocation spelling; use the command shown by that host.

In your project, initialize `.planr` with `planr init` if needed. Ask the installed
Spec skill to shape a request, Plan to prepare the work, and Ship to implement an
approved task. A planning-only request stops at the plan. Agent reasoning stays
in the active host; the utility CLI does not start a separate model process.

Useful deterministic commands include:

```bash
planr doctor --json
planr status --md
planr diagram gallery
planr diagram render ./architecture.planr-diagram.json --json
```

Render output includes a manifest, validation and fidelity reports, and supported
presentation formats. Inspect those reports before treating an export as a
faithful representation. See [diagram authoring](docs/diagrams/authoring.md).

## Repository map

| Path | Responsibility |
| --- | --- |
| `skills/`, `agents/` | Canonical skill guidance and specialist roles |
| `packages/protocol/` | Versioned contracts, schemas, and registries |
| `packages/cli/` | The `openplanr` package and `planr` command |
| `packages/pipeline/` | The self-contained `planr-pipeline` compatibility package |
| `packages/artifact/`, `packages/design/` | Artifact review and design domains |
| `packages/operate/` | Operating-review domain |
| `packages/integrations/` | Portable integration behavior |
| `packages/skill-runtime/` | Skill composition and host generation |
| `apps/dashboard/` | Local planning and operating-review dashboard |
| `adapters/`, `conformance/` | Host projections and contract verification |

The hosted frontend remains in
[openplanr/openplanr-web](https://github.com/openplanr/openplanr-web), with separate
deployment ownership. OpenPlanr Workbench is a separate, deferred initiative.

## Open source and hosted service

The portable product in this repository is MIT licensed. Paid company offerings
provide a separately operated collaboration service and enterprise capabilities;
they do not restrict the license rights granted to this source. Read the
[open source and hosted product boundary](COMMERCIAL.md) and
[trademark policy](TRADEMARKS.md) before packaging or offering a derived service.

## Contributing and ownership

Read the [architecture guide](docs/architecture/README.md),
[skill authoring guide](docs/skills/authoring.md), and
[contribution guide](CONTRIBUTING.md).
[Maintainers](docs/MAINTAINERS.md) describes ownership;
[Releasing](docs/RELEASING.md) describes release checks and authority.
Report vulnerabilities using the [security policy](SECURITY.md).

OpenPlanr is MIT licensed. Original copyright notices and component licenses are
retained. [Provenance](docs/PROVENANCE.md) records the source repositories, versions,
and exact consolidation cutoffs behind the monorepo snapshot.
