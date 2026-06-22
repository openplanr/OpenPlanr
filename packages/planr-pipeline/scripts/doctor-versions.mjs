#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const strictEcosystem = process.env.OPENPLANR_STRICT_ECOSYSTEM === '1';

let failures = 0;
let warnings = 0;

const readText = (path) => readFileSync(join(root, path), 'utf8');
const readJson = (path) => JSON.parse(readText(path));

function ok(message) {
  console.log(`[ok] ${message}`);
}

function fail(message) {
  failures += 1;
  console.error(`[fail] ${message}`);
}

function warn(message) {
  warnings += 1;
  console.warn(`[warn] ${message}`);
}

function expect(condition, message) {
  if (condition) ok(message);
  else fail(message);
}

const pkg = readJson('package.json');
const plugin = readJson('.claude-plugin/plugin.json');
const version = pkg.version;

expect(plugin.version === version, `package.json and .claude-plugin/plugin.json agree on ${version}`);

const stack = readText('input/tech/stack.md');
const stackVersion = stack.match(/^Version:\s*"([^"]+)"/m)?.[1];
expect(stackVersion === version, `input/tech/stack.md Version matches ${version}`);

const protocol = readText('docs/protocol/README.md');
expect(protocol.includes(`planr-pipeline v${version}`), 'protocol README names the current pipeline version');
expect(protocol.includes('schemas/v1.0.0/'), 'protocol README points to schemas/v1.0.0 as canonical');

const matrix = readText('docs/compatibility-matrix.md');
expect(matrix.includes(`planr-pipeline v${version}`), 'compatibility matrix names the current pipeline version');

const sync = readText('commands/sync.md');
expect(!/qa_gate_status:\s*PASS\b/.test(sync), 'sync docs do not use uppercase qa_gate_status');
expect(/qa_gate_status:\s*passed\b/.test(sync), 'sync docs use schema qa_gate_status value "passed"');

expect(existsSync(join(root, 'docs/adrs/ADR-001-protocol-ownership.md')), 'protocol ownership ADR exists');

const staleActiveDocs = [
  'README.md',
  'docs/protocol/README.md',
  'docs/compatibility-matrix.md',
  'docs/protocol/spec-artifacts.md',
  'input/tech/stack.md',
  'commands/sync.md',
  'schemas/v1.0.0/pipeline-shipped.schema.json',
];

const stalePatterns = [
  { label: 'planr-pipeline v0.6.0', regex: /planr-pipeline v0\.6\.0/ },
  { label: 'planr-pipeline v0.13.0', regex: /planr-pipeline v0\.13\.0/ },
  { label: 'pinned model v0.10.0 note', regex: /v0\.10\.0/ },
  { label: 'stack/schema example 0.7.3', regex: /\b0\.7\.3\b/ },
  { label: 'uppercase qa_gate_status PASS', regex: /qa_gate_status:\s*PASS\b/ },
];

for (const file of staleActiveDocs) {
  const text = readText(file);
  for (const { label, regex } of stalePatterns) {
    expect(!regex.test(text), `${file} has no stale ${label}`);
  }
}

const modelContextFiles = [
  'README.md',
  ...readdirSync(join(root, 'agents'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => `agents/${name}`),
];

for (const file of modelContextFiles) {
  const text = readText(file);
  expect(!/claude-[a-z0-9-]+\[[^\]]+\]/i.test(text), `${file} has no explicit Claude context-window suffix`);
}

const workRoot = resolve(root, '..');
const marketplaceManifest = join(workRoot, 'openplanr-marketplace/.claude-plugin/marketplace.json');
if (existsSync(marketplaceManifest)) {
  const manifest = JSON.parse(readFileSync(marketplaceManifest, 'utf8'));
  const pipelinePlugin = (manifest.plugins || []).find((entry) => entry.name === 'planr-pipeline');
  const matches = pipelinePlugin?.version === version;
  if (matches) {
    ok(`marketplace planr-pipeline version matches ${version}`);
  } else if (strictEcosystem) {
    fail(`marketplace planr-pipeline version is ${pipelinePlugin?.version || '(missing)'}, expected ${version}`);
  } else {
    warn(`marketplace planr-pipeline version is ${pipelinePlugin?.version || '(missing)'}, expected ${version}; rerun with OPENPLANR_STRICT_ECOSYSTEM=1 to enforce`);
  }
} else {
  warn('openplanr-marketplace sibling repo not found; skipping optional marketplace version check');
}

const skillsManifest = join(workRoot, 'openplanr-skills/.claude-plugin/marketplace.json');
if (existsSync(skillsManifest)) {
  const manifest = JSON.parse(readFileSync(skillsManifest, 'utf8'));
  const skillVersion = manifest.metadata?.version;
  if (skillVersion) ok(`openplanr-skills manifest reports version ${skillVersion}`);
  else warn('openplanr-skills manifest has no metadata.version');
} else {
  warn('openplanr-skills sibling repo not found; skipping optional skills version report');
}

if (warnings > 0) {
  console.warn(`[warn] ${warnings} warning(s) reported`);
}

if (failures > 0) {
  console.error(`[fail] version doctor found ${failures} failure(s)`);
  process.exit(1);
}

ok('version doctor passed');
