import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

const read = (path) => readFileSync(join(root, path), 'utf8');

function listMarkdown(dir) {
  const abs = join(root, dir);
  return readdirSync(abs)
    .filter((name) => name.endsWith('.md'))
    .map((name) => join(dir, name));
}

test('command and procedure markdown only reference existing procedure files', () => {
  const docs = [...listMarkdown('commands'), ...listMarkdown('procedures')];
  const missing = [];

  for (const file of docs) {
    const text = read(file);
    for (const match of text.matchAll(/(?:\$\{CLAUDE_PLUGIN_ROOT\}\/)?(procedures\/[A-Za-z0-9_.-]+\.md)/g)) {
      const target = match[1];
      if (!existsSync(join(root, target))) missing.push(`${file} -> ${target}`);
    }
  }

  assert.deepEqual(missing, []);
});

test('active docs do not carry stale release-version claims', () => {
  const activeDocs = [
    'README.md',
    'docs/protocol/README.md',
    'docs/compatibility-matrix.md',
    'docs/protocol/spec-artifacts.md',
    'input/tech/stack.md',
    'commands/sync.md',
    'schemas/v1.0.0/pipeline-shipped.schema.json',
  ];
  const stale = [
    ['planr-pipeline v0.6.0', /planr-pipeline v0\.6\.0/],
    ['planr-pipeline v0.13.0', /planr-pipeline v0\.13\.0/],
    ['pinned model v0.10.0 note', /v0\.10\.0/],
    ['stack/schema example 0.7.3', /\b0\.7\.3\b/],
    ['uppercase qa_gate_status PASS', /qa_gate_status:\s*PASS\b/],
  ];

  const hits = [];
  for (const file of activeDocs) {
    const text = read(file);
    for (const [label, regex] of stale) {
      if (regex.test(text)) hits.push(`${file}: ${label}`);
    }
  }

  assert.deepEqual(hits, []);
});

test('plan command and protocol command docs preserve the R1 stop gate', () => {
  const plan = read('commands/plan.md');
  const protocolCommands = read('docs/protocol/commands.md');

  assert.match(plan, /PO Phase NEVER auto-chains to the DEV Phase/);
  assert.match(plan, /human must review/i);
  assert.match(protocolCommands, /PLAN command MUST NOT auto-chain to the SHIP command/);
});

test('qa_gate_status docs use the pipeline-shipped schema values', () => {
  const sync = read('commands/sync.md');
  const ship = read('commands/ship.md');
  const schema = JSON.parse(read('schemas/v1.0.0/pipeline-shipped.schema.json'));

  assert.deepEqual(schema.properties.qa_gate_status.enum, ['passed', 'failed', 'skipped']);
  assert.match(sync, /qa_gate_status:\s*passed/);
  assert.doesNotMatch(sync, /qa_gate_status:\s*PASS\b/);
  assert.match(ship, /qa_gate_status:\s*"<passed \| failed \| skipped>"/);
});

test('Claude Code model strings rely on the default context window', () => {
  const files = ['README.md', ...listMarkdown('agents')];
  const hits = [];

  for (const file of files) {
    const text = read(file);
    if (/claude-[a-z0-9-]+\[[^\]]+\]/i.test(text)) hits.push(file);
  }

  assert.deepEqual(hits, []);
  assert.match(read('agents/frontend-agent.md'), /^model:\s*"?claude-opus-4-8"?$/m);
  assert.match(read('agents/backend-agent.md'), /^model:\s*"?claude-opus-4-8"?$/m);
});

test('ownership map names every ecosystem repo', () => {
  const ownership = read('docs/ownership-map.md');

  for (const repo of ['openplanr/OpenPlanr', 'openplanr/planr-pipeline', 'openplanr/skills', 'openplanr/marketplace']) {
    assert.match(ownership, new RegExp(repo.replace('/', '\\/')));
  }
});

test('release checklist covers the four-repo release train', () => {
  const checklist = read('docs/release-checklist.md');

  for (const repo of ['planr-pipeline', 'marketplace', 'skills', 'OpenPlanr']) {
    assert.match(checklist, new RegExp(`\\b${repo}\\b`));
  }
});

test('doctor docs cover strict release and json modes', () => {
  const doctor = read('docs/doctor.md');

  assert.match(doctor, /--strict/);
  assert.match(doctor, /--release/);
  assert.match(doctor, /--json/);
});

test('ecosystem guide uses canonical surface labels', () => {
  const guide = read('docs/ecosystem-guide.md');

  assert.match(guide, /OpenPlanr plans/);
  assert.match(guide, /planr-pipeline ships/);
  assert.match(guide, /openplanr skill routes/);
  assert.match(guide, /marketplace installs/);
});
