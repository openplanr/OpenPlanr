import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { readHistoricalCustody } from '../../scripts/skills/historical-custody.mjs';
import { syncGeneratedOutputs } from '../../scripts/skills/projection-custody.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-historical-custody-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, bytes) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), bytes);
  };
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Custody Fixture');
  git('config', 'user.email', 'fixture@example.test');
  const prefix = 'dist/plugins/claude/openplanr';
  const old = `${prefix}/skills/design/scripts/runtime.mjs`;
  const oldBytes = 'export const shared = true;\n';
  const manifestPath = 'adapters/manifests/generated-assets.json';
  const manifestBytes = JSON.stringify({
    kind: 'adapter-generated-assets',
    assets: [{ path: old, digest: `sha256:${digest(oldBytes)}` }],
  });
  put(manifestPath, manifestBytes);
  git('add', manifestPath);
  git('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'Record generated baseline');
  const evidence = {
    schemaVersion: '1.0.0',
    kind: 'openplanr-legacy-generated-custody',
    commit: git('rev-parse', 'HEAD'),
    manifests: [{ path: manifestPath, sha256: digest(manifestBytes) }],
    copies: [],
  };
  put(old, oldBytes);
  return { root, put, prefix, old, oldBytes, manifestPath, evidence };
}

for (const transition of ['pull', 'branch switch']) {
  test(`first ${transition} uses recorded historical bytes after the tracked manifest changes, without a ledger`, (t) => {
    const { root, put, prefix, old, manifestPath, evidence } = fixture(t);
    const next = `${prefix}/runtime/design/shared.mjs`;
    put(
      manifestPath,
      JSON.stringify({
        kind: 'adapter-generated-assets',
        assets: [{ path: next, digest: `sha256:${digest('new')}` }],
      }),
    );
    const proof = readHistoricalCustody({ root, evidence });
    assert.deepEqual(proof.unavailable, []);
    const result = syncGeneratedOutputs({
      root,
      scope: 'suite-projections',
      ownedRoots: [prefix],
      outputs: new Map([[next, Buffer.from('new')]]),
      bootstrap: proof.suite,
      mode: 'write',
    });
    assert.equal(result.retiredFiles, 1);
    assert.equal(existsSync(join(root, old)), false);
    assert.equal(readFileSync(join(root, next), 'utf8'), 'new');
  });
}

test('historical manifest evidence cannot retire modified output', (t) => {
  const { root, put, prefix, old, evidence } = fixture(t);
  put(old, 'customer edit');
  const proof = readHistoricalCustody({ root, evidence });
  assert.throws(
    () =>
      syncGeneratedOutputs({
        root,
        scope: 'suite-projections',
        ownedRoots: [prefix],
        outputs: new Map(),
        bootstrap: proof.suite,
        mode: 'write',
      }),
    /unproven or modified bytes/u,
  );
  assert.equal(readFileSync(join(root, old), 'utf8'), 'customer edit');
});

test('unavailable historical objects in shallow history preserve unknown files', (t) => {
  const { root, prefix, old, oldBytes, evidence } = fixture(t);
  const proof = readHistoricalCustody({ root, evidence, readObject: () => null });
  assert.deepEqual(proof.suite, []);
  assert.deepEqual(proof.unavailable, [evidence.manifests[0].path]);
  assert.throws(
    () =>
      syncGeneratedOutputs({
        root,
        scope: 'suite-projections',
        ownedRoots: [prefix],
        outputs: new Map(),
        bootstrap: proof.suite,
        mode: 'write',
      }),
    /unknown generated output preserved/u,
  );
  assert.equal(readFileSync(join(root, old), 'utf8'), oldBytes);
});

test('historical proof rejects altered bytes and unsafe object references before reads', (t) => {
  const { root, evidence } = fixture(t);
  assert.throws(
    () => readHistoricalCustody({ root, evidence, readObject: () => Buffer.from('altered') }),
    /digest mismatch/u,
  );
  let reads = 0;
  assert.throws(
    () =>
      readHistoricalCustody({
        root,
        evidence: { ...evidence, manifests: [{ ...evidence.manifests[0], path: '../outside' }] },
        readObject: () => {
          reads++;
          return null;
        },
      }),
    /Unsafe historical/u,
  );
  assert.equal(reads, 0);
});

test('partial shared helper scope preserves unrelated inputs while retiring its recorded helpers', (t) => {
  const { root, put } = fixture(t);
  const target = 'skills/planr-ceo-review/scripts/validate-note.mjs';
  const unrelated = 'skills/planr-ceo-review/references/customer.md';
  const sync = (outputs) =>
    syncGeneratedOutputs({
      root,
      scope: 'source-projections',
      ownedRoots: ['skills'],
      outputs: new Map(Object.entries(outputs)),
      mode: 'write',
      completeRoots: false,
    });
  put(unrelated, 'hand written');
  sync({ [target]: 'generated' });
  const result = sync({});
  assert.equal(result.retiredFiles, 1);
  assert.equal(existsSync(join(root, target)), false);
  assert.equal(readFileSync(join(root, unrelated), 'utf8'), 'hand written');
});
