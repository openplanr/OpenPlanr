import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  ensurePrivateDirectory,
  readCustody,
  resolveRecoveryOutputPath,
  writeCustody,
} from '../lib/artifact/owner-custody.mjs';

const format = 'owner-custody-test';
const record = { kind: format, schemaVersion: '1.0.0', custody: { test: true } };
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'planr-owner-custody-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('recovery inputs resolve symlinked ancestry while custody stores remain strict', (t) => {
  const root = fixture(t),
    actual = join(root, 'actual'),
    alias = join(root, 'alias');
  ensurePrivateDirectory(actual);
  const file = join(actual, 'recovery.json');
  writeCustody(file, record, { label: 'Design' });
  symlinkSync(actual, alias);
  const input = join(alias, 'recovery.json');
  assert.deepEqual(readCustody(input, { label: 'Design', format, recoveryInput: true }), record);
  for (const action of [
    () => readCustody(input, { label: 'Design', format }),
    () => writeCustody(input, record, { label: 'Design' }),
    () => ensurePrivateDirectory(alias, { label: 'Design' }),
  ]) {
    assert.throws(
      action,
      (error) =>
        error.code === 'E_OWNER_CUSTODY_LOCATION' &&
        error.status === 400 &&
        error.message.startsWith('Design'),
    );
  }
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), record);
  const linkedFile = join(root, 'linked-file.json');
  symlinkSync(file, linkedFile);
  assert.throws(
    () => readCustody(linkedFile, { label: 'Design', format, recoveryInput: true }),
    (error) => error.code === 'E_OWNER_CUSTODY_INVALID' && error.status === 400,
  );
});

test('existing recovery folders retain permissions while permissive custody stores are rejected', (t) => {
  if (process.platform === 'win32') return;
  const root = fixture(t),
    selected = join(root, 'selected');
  mkdirSync(selected, { mode: 0o755 });
  chmodSync(selected, 0o755);
  ensurePrivateDirectory(selected, { label: 'Diagram', recoveryOutput: true });
  assert.equal(statSync(selected).mode & 0o777, 0o755);
  assert.throws(
    () => ensurePrivateDirectory(selected, { label: 'Diagram' }),
    (error) => error.code === 'E_OWNER_CUSTODY_LOCATION' && error.status === 400,
  );
  assert.equal(statSync(selected).mode & 0o777, 0o755);
  const recovery = join(selected, 'recovery.json');
  writeFileSync(recovery, JSON.stringify(record), { mode: 0o600 });
  assert.deepEqual(readCustody(recovery, { format, recoveryInput: true }), record);
  for (const action of [
    () => readCustody(recovery, { format }),
    () => writeCustody(recovery, record, { label: 'Diagram' }),
  ]) {
    assert.throws(action, (error) => error.code === 'E_OWNER_CUSTODY_LOCATION');
  }
  assert.equal(statSync(selected).mode & 0o777, 0o755);
  const created = join(selected, 'new', 'private');
  ensurePrivateDirectory(created, { label: 'Diagram', recoveryOutput: true });
  assert.equal(statSync(created).mode & 0o777, 0o700);
  assert.equal(statSync(join(selected, 'new')).mode & 0o777, 0o700);
  const alias = join(root, 'selected-alias');
  symlinkSync(selected, alias);
  ensurePrivateDirectory(alias, { label: 'Diagram', recoveryOutput: true });
  assert.equal(statSync(selected).mode & 0o777, 0o755);
  assert.equal(
    resolveRecoveryOutputPath(join(alias, 'more', 'recovery.json')),
    join(selected, 'more', 'recovery.json'),
  );
  ensurePrivateDirectory(join(alias, 'more'), { recoveryOutput: true });
  assert.equal(statSync(join(selected, 'more')).mode & 0o777, 0o700);
});

test('private-file faults preserve caller labels and do not expose malformed recovery bytes', (t) => {
  if (process.platform === 'win32') return;
  const root = fixture(t),
    file = join(root, 'record.json');
  writeFileSync(file, JSON.stringify(record), { mode: 0o600 });
  chmodSync(file, 0o644);
  assert.throws(
    () => writeCustody(file, record, { label: 'Diagram' }),
    (error) => error.code === 'E_OWNER_CUSTODY_INVALID' && error.message.startsWith('Diagram'),
  );
  assert.equal(statSync(file).mode & 0o777, 0o644);
  chmodSync(file, 0o600);
  writeFileSync(file, '{ private-recovery-bytes');
  assert.throws(
    () => readCustody(file, { label: 'Design', format, recoveryInput: true }),
    (error) =>
      error.code === 'E_OWNER_CUSTODY_INVALID' &&
      error.message === 'Design owner custody is invalid.',
  );
});
