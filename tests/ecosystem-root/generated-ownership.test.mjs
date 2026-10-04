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
import {
  GeneratedOwnership,
  generatedPath,
  writeGeneratedOutput,
} from '../../scripts/lib/generated-ownership.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const owned = (owner, target) => owner === 'fixture' && target.startsWith('generated/');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-generated-custody-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = (target, bytes) => {
    mkdirSync(dirname(join(root, target)), { recursive: true });
    writeFileSync(join(root, target), bytes);
    return { owner: 'fixture', target, sha256: digest(bytes) };
  };
  const ledger = () => new GeneratedOwnership({ root, scope: 'test-projection', owns: owned });
  return { root, output, ledger };
}

for (const event of [
  'pull replaces the tracked manifest',
  'branch switch restores an older manifest',
]) {
  test(`local ownership survives when ${event}`, (t) => {
    const { root, output, ledger } = fixture(t);
    const retired = output('generated/retired.mjs', 'export const obsolete = true;\n');
    ledger().bootstrap([retired]).record([retired]).save();
    // The new tracked manifest contains none of the old output, in either direction.
    const next = ledger().bootstrap([]);
    const result = next.retire({ owners: ['fixture'], expectedPaths: new Set(), write: true });
    assert.deepEqual(result.conflicts, []);
    assert.deepEqual(result.retired, [retired]);
    assert.equal(existsSync(join(root, retired.target)), false);
    next.save();
    assert.deepEqual(ledger().retire({ owners: ['fixture'], expectedPaths: new Set() }), {
      retired: [],
      conflicts: [],
    });
  });
}

test('bootstrap requires the recorded hash, preserving and reporting unproven or modified bytes', (t) => {
  const { root, output, ledger } = fixture(t);
  const entry = output('generated/retired.mjs', 'customer code\n');
  const state = ledger().bootstrap([{ ...entry, sha256: '0'.repeat(64) }]);
  const result = state.retire({ owners: ['fixture'], expectedPaths: new Set(), write: true });
  assert.equal(result.retired.length, 0);
  assert.equal(result.conflicts[0].reason, 'unproven or modified bytes');
  assert.equal(readFileSync(join(root, entry.target), 'utf8'), 'customer code\n');
});

test('a file modified after ownership was recorded remains owned but is never removed', (t) => {
  const { root, output, ledger } = fixture(t);
  const entry = output('generated/retired.mjs', 'generated code\n');
  ledger().record([entry]).save();
  output(entry.target, 'customer edit\n');
  const state = ledger();
  const result = state.retire({ owners: ['fixture'], expectedPaths: new Set(), write: true });
  assert.equal(result.conflicts[0].reason, 'unproven or modified bytes');
  state.save();
  assert.equal(readFileSync(join(root, entry.target), 'utf8'), 'customer edit\n');
  assert.equal(ledger().records.size, 1);
});

test('ownership is rechecked immediately before retirement and concurrent edits are preserved', (t) => {
  const { root, output, ledger } = fixture(t);
  const entry = output('generated/retired.mjs', 'generated code\n');
  const result = ledger()
    .record([entry])
    .retire({
      owners: ['fixture'],
      expectedPaths: new Set(),
      write: true,
      beforeRemove: () => output(entry.target, 'concurrent user edit\n'),
    });
  assert.equal(result.retired.length, 0);
  assert.equal(result.conflicts[0].reason, 'changed during retirement');
  assert.equal(readFileSync(join(root, entry.target), 'utf8'), 'concurrent user edit\n');
});

test('unknown files and unselected generator ownership are not retired', (t) => {
  const { root, output, ledger } = fixture(t);
  output('generated/customer.mjs', 'customer file\n');
  const entry = output('generated/retired.mjs', 'generated code\n');
  const state = ledger().record([entry]);
  const result = state.retire({ owners: [], expectedPaths: new Set(), write: true });
  assert.deepEqual(result, { retired: [], conflicts: [] });
  assert.equal(readFileSync(join(root, 'generated/customer.mjs'), 'utf8'), 'customer file\n');
  assert.equal(existsSync(join(root, entry.target)), true);
});

test('replacement permits owned or exact canonical outputs but preserves unknown and modified outputs', (t) => {
  const { output, ledger } = fixture(t);
  const entry = output('generated/current.mjs', 'generated code\n');
  const state = ledger().record([entry]);
  const next = { ...entry, sha256: digest('next canonical version\n') };
  assert.deepEqual(state.verifyWrites([next]), []);
  output(entry.target, 'customer edit\n');
  assert.equal(state.verifyWrites([next])[0].reason, 'unproven or modified bytes');
  output(entry.target, 'next canonical version\n');
  assert.deepEqual(state.verifyWrites([next]), []);
  assert.deepEqual(ledger().verifyWrites([next]), []);
  const unknown = output('generated/unknown.mjs', 'unknown bytes\n');
  assert.equal(
    ledger().verifyWrites([{ ...unknown, sha256: next.sha256 }])[0].reason,
    'unproven or modified bytes',
  );
});

test('check mode neither deletes an owned file nor creates the ledger', (t) => {
  const { root, output, ledger } = fixture(t);
  const entry = output('generated/retired.mjs', 'generated code\n');
  const state = ledger().bootstrap([entry]);
  assert.equal(state.retire({ owners: ['fixture'], expectedPaths: new Set() }).retired.length, 1);
  assert.equal(existsSync(join(root, entry.target)), true);
  assert.equal(existsSync(join(root, state.target)), false);
});

test('unsafe paths, symlink ancestors and symlink files cannot establish custody', (t) => {
  const { root, output, ledger } = fixture(t);
  const entry = output('generated/file.mjs', 'generated code\n');
  for (const target of [
    'generated/../file.mjs',
    '/generated/file.mjs',
    'generated\\file.mjs',
    'generated//file.mjs',
  ]) {
    assert.throws(() => ledger().bootstrap([{ ...entry, target }]), /Unsafe|Unowned/u);
    assert.throws(() => generatedPath(root, target), /Unsafe/u);
  }
  const outside = join(root, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'file.mjs'), 'outside\n');
  symlinkSync(outside, join(root, 'generated/link'));
  const state = ledger().bootstrap([{ ...entry, target: 'generated/link/file.mjs' }]);
  const result = state.retire({ owners: ['fixture'], expectedPaths: new Set(), write: true });
  assert.match(result.conflicts[0].reason, /Symlink/u);
  assert.equal(readFileSync(join(outside, 'file.mjs'), 'utf8'), 'outside\n');
  symlinkSync(join(root, entry.target), join(root, 'generated/file-link.mjs'));
  assert.throws(() => generatedPath(root, 'generated/file-link.mjs'), /Symlink/u);
});

test('malformed ownership and concurrent ledger updates are actionable failures', (t) => {
  const { root, output, ledger } = fixture(t);
  const first = ledger();
  const second = ledger();
  const entry = output('generated/file.mjs', 'generated code\n');
  first.record([entry]).save();
  assert.throws(() => second.save(), /changed concurrently/u);
  writeFileSync(join(root, first.target), '{');
  assert.throws(() => ledger(), /Malformed/u);
});

test('identical ownership is an unchanged second save', (t) => {
  const { output, ledger } = fixture(t);
  const entry = output('generated/file.mjs', 'generated code\n');
  assert.equal(ledger().record([entry]).save(), true);
  assert.equal(ledger().record([entry]).save(), false);
});

test('a concurrent edit during staging is checked immediately before replacement', (t) => {
  const { root, output, ledger } = fixture(t);
  const previous = output('generated/current.mjs', 'generated');
  const state = ledger().record([previous]);
  const bytes = Buffer.from('next');
  const next = { ...previous, sha256: digest(bytes) };
  assert.throws(
    () =>
      writeGeneratedOutput({
        root,
        target: previous.target,
        bytes,
        mode: 0o644,
        recheck: () => {
          output(previous.target, 'concurrent customer edit');
          const conflicts = state.verifyWrites([next]);
          if (conflicts.length > 0) throw new Error('Concurrent ownership conflict');
        },
      }),
    /Concurrent ownership conflict/u,
  );
  assert.equal(readFileSync(join(root, previous.target), 'utf8'), 'concurrent customer edit');
});
