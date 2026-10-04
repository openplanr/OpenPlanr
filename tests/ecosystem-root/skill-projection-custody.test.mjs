import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { syncGeneratedOutputs } from '../../scripts/skills/projection-custody.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-skill-projection-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const prefix = 'dist/plugins/claude/openplanr';
  const path = (tail) => `${prefix}/${tail}`;
  const put = (target, bytes) => {
    mkdirSync(dirname(join(root, target)), { recursive: true });
    writeFileSync(join(root, target), bytes);
    return { target, sha256: digest(bytes) };
  };
  const sync = (outputs, options = {}) =>
    syncGeneratedOutputs({
      root,
      scope: 'skill-test',
      ownedRoots: [prefix],
      outputs: new Map(Object.entries(outputs)),
      mode: 'write',
      ...options,
    });
  return { root, prefix, path, put, sync };
}

test('generated skill outputs bootstrap only recorded bytes and have an unchanged second synchronization', (t) => {
  const { root, path, put, sync } = fixture(t);
  const target = path('runtime/shared.mjs');
  const previous = put(target, 'export const version = 1;\n');
  const next = 'export const version = 2;\n';
  assert.equal(sync({ [target]: next }, { bootstrap: [previous] }).changedFiles, 1);
  assert.equal(readFileSync(join(root, target), 'utf8'), next);
  assert.equal(sync({ [target]: next }).changedFiles, 0);
  assert.equal(sync({ [target]: next }, { mode: 'check' }).changedFiles, 0);
});

for (const transition of ['pull', 'branch switch']) {
  test(`shared runtime relocation retires old owned copies after a simulated ${transition}`, (t) => {
    const { root, path, sync } = fixture(t);
    const old = path('skills/design/scripts/runtime/shared.mjs');
    sync({ [old]: 'export const shared = true;\n' });
    // The changed tracked manifest no longer names the old copy; local custody still does.
    const next = path('runtime/design/shared.mjs');
    const result = sync({ [next]: 'export const shared = true;\n' }, { bootstrap: [] });
    assert.equal(result.retiredFiles, 1);
    assert.equal(existsSync(join(root, old)), false);
    assert.equal(readFileSync(join(root, next), 'utf8'), 'export const shared = true;\n');
    assert.equal(sync({ [next]: 'export const shared = true;\n' }).changedFiles, 0);
  });
}

test('unknown files prevent synchronization without being removed or overwritten', (t) => {
  const { root, path, put, sync } = fixture(t);
  const unknown = path('skills/design/scripts/customer.mjs');
  put(unknown, 'customer code\n');
  const next = path('runtime/design/shared.mjs');
  assert.throws(() => sync({ [next]: 'generated\n' }), /unknown generated output preserved/u);
  assert.equal(readFileSync(join(root, unknown), 'utf8'), 'customer code\n');
  assert.equal(existsSync(join(root, next)), false);
});

test('modified owned outputs and retirement candidates remain unchanged', (t) => {
  const { root, path, put, sync } = fixture(t);
  const old = path('skills/design/scripts/runtime/shared.mjs');
  sync({ [old]: 'generated\n' });
  put(old, 'customer edit\n');
  const next = path('runtime/design/shared.mjs');
  assert.throws(() => sync({ [next]: 'generated\n' }), /unproven or modified bytes/u);
  assert.equal(readFileSync(join(root, old), 'utf8'), 'customer edit\n');
  assert.equal(existsSync(join(root, next)), false);
  assert.throws(() => sync({ [old]: 'updated generated\n' }), /unproven or modified bytes/u);
});

test('concurrent edits after planning are checked before overwriting output', (t) => {
  const { root, path, put, sync } = fixture(t);
  const target = path('runtime/shared.mjs');
  sync({ [target]: 'generated\n' });
  assert.throws(
    () =>
      sync(
        { [target]: 'next\n' },
        {
          beforeWrite: () => put(target, 'concurrent customer edit\n'),
        },
      ),
    /changed during synchronization/u,
  );
  assert.equal(readFileSync(join(root, target), 'utf8'), 'concurrent customer edit\n');
});

test('check mode preserves stale output and never creates custody state', (t) => {
  const { root, path, put, sync } = fixture(t);
  const old = path('skills/design/scripts/runtime/shared.mjs');
  const previous = put(old, 'generated\n');
  assert.throws(() => sync({}, { mode: 'check', bootstrap: [previous] }), /retired output/u);
  assert.equal(existsSync(join(root, old)), true);
  assert.equal(
    existsSync(join(root, '.cache/openplanr/generated-ownership/skill-test.json')),
    false,
  );
});

test('symlinked roots and nested outputs cannot touch files outside the generated tree', (t) => {
  const { root, prefix, path, put, sync } = fixture(t);
  const outside = join(root, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'shared.mjs'), 'outside\n');
  mkdirSync(join(root, prefix), { recursive: true });
  symlinkSync(outside, join(root, prefix, 'runtime'));
  assert.throws(() => sync({ [path('runtime/shared.mjs')]: 'generated\n' }), /Symlink/u);
  assert.equal(readFileSync(join(outside, 'shared.mjs'), 'utf8'), 'outside\n');
  rmSync(join(root, prefix, 'runtime'));
  const target = path('runtime/shared.mjs');
  put(target, 'generated\n');
  symlinkSync(join(outside, 'shared.mjs'), join(root, prefix, 'customer-link.mjs'));
  assert.throws(() => sync({ [target]: 'generated\n' }), /Symlink/u);
});

test('unrelated checkout files and explicitly preserved inputs remain outside ownership', (t) => {
  const { root, path, put, sync } = fixture(t);
  const manual = path('skills/plan/scripts/planning-ids.mjs');
  put(manual, 'maintained helper\n');
  put('customer-project/source.mjs', 'customer source\n');
  const target = path('runtime/shared.mjs');
  const result = sync({ [target]: 'generated\n' }, { preservePaths: new Set([manual]) });
  assert.equal(result.files, 1);
  assert.equal(readFileSync(join(root, manual), 'utf8'), 'maintained helper\n');
  assert.equal(
    readFileSync(join(root, 'customer-project/source.mjs'), 'utf8'),
    'customer source\n',
  );
});
