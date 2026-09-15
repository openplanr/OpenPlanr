import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function fixture() {
  const temporary = mkdtempSync(join(tmpdir(), 'openplanr-publication-custody-'));
  const root = join(temporary, 'source');
  const protocol = join(root, 'packages/protocol');
  mkdirSync(join(protocol, 'src'), { recursive: true });
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, '.changeset'));
  writeFileSync(join(root, '.changeset/README.md'), 'Release notes\n');
  writeFileSync(join(root, '.gitignore'), 'packages/protocol/src/private.mjs\n');
  copyFileSync(join(repository, 'scripts/prepare-publication.mjs'), join(root, 'scripts/prepare-publication.mjs'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'publication-fixture', private: true, workspaces: ['packages/protocol'] }));
  writeFileSync(join(protocol, 'package.json'), JSON.stringify({
    name: '@openplanr/protocol', version: '0.2.0', type: 'module', license: 'MIT',
    repository: { type: 'git', url: 'git+https://github.com/openplanr/OpenPlanr.git' }, files: ['src/'],
  }));
  writeFileSync(join(protocol, 'src/index.mjs'), 'export const version = "fixture";\n');
  for (const args of [
    ['init', '-q'], ['config', 'user.name', 'Publication test'],
    ['config', 'user.email', 'publication-test@example.invalid'], ['add', '.'],
    ['commit', '-qm', 'Create reviewed publication fixture'],
  ]) execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  return { temporary, root, protocol };
}

function prepare({ root, temporary }, output = join(temporary, 'publication')) {
  return spawnSync(process.execPath, [join(root, 'scripts/prepare-publication.mjs'), output], {
    cwd: root, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, RELEASE_PACKAGE: '@openplanr/protocol', RELEASE_VERSION: '0.2.0', npm_config_audit: 'false', npm_config_fund: 'false' },
  });
}

test('publication archives only the exact reviewed Git source and records its commit', () => {
  const f = fixture();
  try {
    const result = prepare(f);
    assert.equal(result.status, 0, result.stderr);
    const proof = JSON.parse(readFileSync(join(f.temporary, 'publication/publication.json'), 'utf8'));
    assert.equal(proof.name, '@openplanr/protocol');
    assert.equal(proof.version, '0.2.0');
    assert.equal(proof.commit, execFileSync('git', ['rev-parse', 'HEAD'], { cwd: f.root, encoding: 'utf8' }).trim());
    assert.match(proof.sha256, /^[a-f0-9]{64}$/u);
  } finally { rmSync(f.temporary, { recursive: true, force: true }); }
});

test('publication rejects untracked and ignored source injections', () => {
  for (const [file, error] of [
    ['unexpected.mjs', /untracked files before publication/u],
    ['private.mjs', /not a reviewed source or declared build output: src\/private.mjs/u],
  ]) {
    const f = fixture();
    try {
      writeFileSync(join(f.protocol, 'src', file), 'export const confidential = true;\n');
      const result = prepare(f);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, error);
    } finally { rmSync(f.temporary, { recursive: true, force: true }); }
  }
});

test('publication requires consumed changesets and an output outside the source tree', () => {
  const f = fixture();
  try {
    assert.match(prepare(f, join(f.root, 'output')).stderr, /outside the source checkout/u);
    writeFileSync(join(f.root, '.changeset/pending.md'), '---\n"@openplanr/protocol": minor\n---\nPending change\n');
    const result = prepare(f);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Consume and review Changesets/u);
  } finally { rmSync(f.temporary, { recursive: true, force: true }); }
});

test('every isolated packed CI runner installs the declared Protocol browser dependency', () => {
  const workflow = readFileSync(join(repository, '.github/workflows/ci.yml'), 'utf8');
  const packed = workflow.slice(workflow.indexOf('  packed-public-packages:'));
  assert.match(packed, /node: \[20, 22, 24\]/u);
  const browser = packed.indexOf('npm exec --workspace=@openplanr/protocol -- playwright install --with-deps chromium');
  const proof = packed.indexOf('npm run verify:packed:strict');
  assert.ok(browser > 0 && proof > browser, 'Packed CI must install its own browser before consumer execution');
});
