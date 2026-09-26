# `@openplanr/dashboard-app`

The browser app behind `planr dashboard`: a read-only React view of a project's planning
artifacts and Operate state. It imports only browser dependencies and `@openplanr/protocol`.
The CLI build copies `dist/` into `packages/cli/dist/dashboard` under a digest manifest, and
`planr dashboard` serves that copy on a loopback port.

This workspace is npm-private; it ships only inside the CLI.

## Develop

Run these from the repository root.

```bash
npm run dev --workspace apps/dashboard
```

Vite serves the app with hot reload at <http://127.0.0.1:4173/> (set
`OPENPLANR_DASHBOARD_FIXTURE_PORT` for another port). The API comes from the sample project
the browser tests use (`packages/cli/tests/e2e/fixtures/`, wired by
`packages/cli/vite.dashboard.fixture.config.ts`), so no `.planr` directory is needed. Open a
route by its hash (`/#/board`) and switch presentation with `?theme=dark`,
`?density=compact` or `?contrast=high`.

| Command | What it does |
| --- | --- |
| `npm run build --workspace apps/dashboard` | Production build into `dist/`, with `dashboard-manifest.json` |
| `npm run typecheck --workspace apps/dashboard` | TypeScript over `src/` and `vite.config.ts` |
| `npm test --workspace apps/dashboard` | Architecture tests: import boundaries, responsive shell, list scalability |
| `npm run test:browser --workspace openplanr` | Chromium visual regression against the fixture, with `planr-pipeline` installed from a packed tarball |
| `npm run lint` | The root Biome gate, which covers `src/` and `tests/` |

The browser suite needs Playwright's Chromium (`./node_modules/.bin/playwright install
chromium`); `CONTRIBUTING.md` lists the variables that control it.
