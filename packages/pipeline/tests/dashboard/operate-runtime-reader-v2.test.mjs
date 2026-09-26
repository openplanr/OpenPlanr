import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

import { readOperatingProjection } from '../../lib/dashboard/operate-reader.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temporaryRoot = mkdtempSync(join(tmpdir(), 'planr-operate-runtime-reader-'));

after(() => rmSync(temporaryRoot, { recursive: true, force: true }));

function fixture(name) {
  return JSON.parse(
    readFileSync(join(root, 'conformance/fixtures/operating-runtime-v2', name), 'utf8'),
  );
}

function writeProjection(directory, state, checkpoint) {
  const projectionDirectory = join(directory, 'operate/projections');
  const checkpointDirectory = join(directory, 'operate/checkpoints');
  mkdirSync(projectionDirectory, { recursive: true });
  mkdirSync(checkpointDirectory, { recursive: true });
  writeFileSync(join(projectionDirectory, 'runtime-state.json'), `${JSON.stringify(state)}\n`);
  writeFileSync(join(checkpointDirectory, 'current.json'), `${JSON.stringify(checkpoint)}\n`);
}

test('the dashboard reads only validated Operate Runtime 2.0 projection identities', () => {
  const planrDirectory = join(temporaryRoot, 'valid/.planr');
  const contracts = fixture('all-contracts-valid.json');
  writeProjection(
    planrDirectory,
    contracts['operating-runtime-state'],
    contracts['operating-checkpoint'],
  );

  const projection = readOperatingProjection(planrDirectory);
  assert.equal(projection.status, 'ready');
  assert.equal(projection.readOnly, true);
  assert.equal(projection.state.protocolVersion, '2.0.0');
  assert.equal(
    projection.state.eventHead.sequence,
    contracts['operating-checkpoint'].eventHead.sequence,
  );
});

test('a legacy state.json file is not probed or translated', () => {
  const planrDirectory = join(temporaryRoot, 'legacy/.planr');
  const legacyDirectory = join(planrDirectory, 'operate/projections');
  mkdirSync(legacyDirectory, { recursive: true });
  writeFileSync(join(legacyDirectory, 'state.json'), JSON.stringify({ protocolVersion: '1.4.0' }));

  assert.deepEqual(readOperatingProjection(planrDirectory), {
    available: false,
    readOnly: true,
    status: 'absent',
    path: '.planr/operate/projections/runtime-state.json',
    state: null,
  });
});

test('a validated v2 projection with a divergent checkpoint is stale, never repaired', () => {
  const planrDirectory = join(temporaryRoot, 'stale/.planr');
  const contracts = fixture('all-contracts-valid.json');
  const checkpoint = structuredClone(contracts['operating-checkpoint']);
  checkpoint.eventHead.sequence += 1;
  writeProjection(planrDirectory, contracts['operating-runtime-state'], checkpoint);

  const projection = readOperatingProjection(planrDirectory);
  assert.equal(projection.status, 'stale');
  assert.equal(projection.readOnly, true);
  assert.match(projection.recovery, /does not repair|Inspect integrity/i);
});
