#!/usr/bin/env node
// Verifies every committed documentation diagram set with the built CLI, so a
// README image can never drift from the canonical document it was rendered from.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const diagramsRoot = path.join(repoRoot, 'docs/diagrams');
const cli = path.join(repoRoot, 'packages/cli/bin/planr.js');

if (!existsSync(path.join(repoRoot, 'packages/cli/dist'))) {
  console.error('check:diagrams needs the built CLI. Run `npm run build` first.');
  process.exit(1);
}

const manifests = readdirSync(diagramsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(diagramsRoot, entry.name, `${entry.name}.manifest.json`))
  .filter((manifest) => existsSync(manifest));

if (manifests.length === 0) {
  console.error(`No diagram sets found under ${path.relative(repoRoot, diagramsRoot)}.`);
  process.exit(1);
}

let failed = false;
for (const manifest of manifests) {
  const result = spawnSync(process.execPath, [cli, 'diagram', 'check', manifest, '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    report = null;
  }
  const relative = path.relative(repoRoot, manifest);
  if (result.status !== 0 || !report?.ok || report.status !== 'passed') {
    failed = true;
    console.error(`FAIL ${relative}`);
    console.error((result.stdout || '').trim());
    console.error((result.stderr || '').trim());
    continue;
  }
  console.log(`PASS ${relative} (${report.artifacts.length} artifacts)`);
}
process.exit(failed ? 1 : 0);
