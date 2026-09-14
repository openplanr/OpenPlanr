# Repository scripts

These are maintained source files. Track scripts that contributors and CI need to
build, generate, validate, test or package the product. Run public entrypoints
through the root `package.json`; use the root lockfile.

| Area | Purpose |
| --- | --- |
| `generate-all.mjs`, `protocol/`, `domains/`, `marketplace/` | Reproducible schemas, runtime projections and host metadata |
| `dashboard/` | Build and verify the bundled local dashboard |
| `skills/` | Author, validate, generate, evaluate and package current host skills |
| `check-*.mjs`, `lib/` | Dependency, composition and release-policy checks |
| `run-focused-tests.mjs`, `workspace-command.mjs` | Repeatable workspace verification |
| `verify-packed-workspace*.mjs` | Isolated public-package install proof |
| `migration/` | Executable legacy contract preservation checks |
| `prepare-publication.mjs` | Validate and pack one reviewed public release; does not publish |

Temporary diagnostics, one-time migration tools, ADRs, checklists and run receipts
belong in ignored `.planr/`. Build output and local distributions live in ignored
`dist/` and `release/`. Neither scripts nor CI may require those private planning
records. Hosted deployment tooling is owned by the private web repository.
