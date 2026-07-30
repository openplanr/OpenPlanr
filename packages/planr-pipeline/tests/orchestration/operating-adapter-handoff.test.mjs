import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createOperatingAdapterHandoff,
  validateOperatingAdapterHandoffBindings,
} from '../../lib/operate/adapter-handoff.mjs';

const digest = (value) => `sha256:${value.repeat(64)}`;
const lease = 'a'.repeat(43);
const expiresAt = '2026-07-30T12:00:00.000Z';

function input(state, overrides = {}) {
  const prepared = state !== 'prepare-required';
  const completed = ['finalize-required', 'continue-required'].includes(state);
  return {
    phase: 'advisors',
    state,
    cycleId: 'CYCLE-001',
    evidenceDigest: digest('e'),
    runtime: 'codex',
    idempotencyKey: 'native-CYCLE-001-advisors',
    lease: prepared ? lease : null,
    expiresAt: prepared ? expiresAt : null,
    roles: [
      {
        roleId: 'strategy-finance',
        status: prepared ? (completed ? 'recorded' : 'pending') : 'awaiting-prepare',
        inputDigest: prepared ? digest('a') : null,
      },
    ],
    ...overrides,
  };
}

test('builder emits only the actions legal in each lifecycle state', () => {
  const prepare = createOperatingAdapterHandoff(input('prepare-required'));
  assert.deepEqual(prepare.next.map(({ action }) => action), ['adapter.prepare']);
  assert.deepEqual(prepare.recovery, []);
  assert.ok(prepare.next[0].argv.includes('--json'));

  const record = createOperatingAdapterHandoff(input('record-required'));
  assert.deepEqual(record.next.map(({ action }) => action), ['adapter.record']);
  assert.deepEqual(record.recovery.map(({ action }) => action), [
    'adapter.resume',
    'adapter.cancel',
  ]);
  assert.equal(record.next[0].stdin.maxBytes, 32768);
  assert.equal(record.next[0].dispatch.rolePackPointer, '/data/rolePacks/strategy-finance');
  assert.equal(
    record.next[0].stdin.schemaPointer,
    '/data/rolePacks/strategy-finance/roleBrief/output/jsonSchema',
  );

  const finalize = createOperatingAdapterHandoff(input('finalize-required'));
  assert.deepEqual(finalize.next.map(({ action }) => action), ['adapter.finalize']);
  assert.equal(finalize.next[0].effect, 'project-write');

  const complete = createOperatingAdapterHandoff(input('continue-required'));
  assert.deepEqual(complete.next.map(({ action }) => action), ['run.continue']);
  assert.deepEqual(complete.next[0].argv, [
    'planr',
    'operate',
    'run',
    '--cycle-id',
    'CYCLE-001',
    '--runtime',
    'codex',
    '--json',
  ]);
  assert.deepEqual(complete.recovery, []);

  const cancelled = createOperatingAdapterHandoff(input('cancelled', {
    roles: [{
      roleId: 'strategy-finance',
      status: 'pending',
      inputDigest: digest('a'),
    }],
  }));
  assert.deepEqual(cancelled.next, []);
  assert.deepEqual(cancelled.recovery, []);
});

test('builder binds advisor and chair commands to one exact root identity', () => {
  const advisors = createOperatingAdapterHandoff(input('record-required', {
    roles: [
      { roleId: 'strategy-finance', status: 'pending', inputDigest: digest('a') },
      { roleId: 'technology-risk', status: 'recorded', inputDigest: digest('b') },
    ],
  }));
  assert.deepEqual(advisors.next[0].argv, [
    'planr',
    'operate',
    'adapter',
    'record',
    '--role',
    'strategy-finance',
    '--cycle-id',
    'CYCLE-001',
    '--evidence-digest',
    digest('e'),
    '--lease',
    lease,
    '--idempotency-key',
    'native-CYCLE-001-advisors',
    '--stdin',
    '--json',
  ]);

  const chair = createOperatingAdapterHandoff(input('prepare-required', {
    phase: 'chair',
    idempotencyKey: 'native-CYCLE-001-chair',
    roles: [{ roleId: 'chair', status: 'awaiting-prepare', inputDigest: null }],
  }));
  assert.deepEqual(chair.next[0].argv.slice(-3), [
    '--role',
    'chair',
    '--json',
  ]);
});

test('builder serializes record mutations while preserving every pending role', () => {
  const first = createOperatingAdapterHandoff(input('record-required', {
    roles: [
      { roleId: 'strategy-finance', status: 'pending', inputDigest: digest('a') },
      { roleId: 'technology-risk', status: 'pending', inputDigest: digest('b') },
    ],
  }));
  assert.deepEqual(first.next.map(({ role }) => role), ['strategy-finance']);
  assert.deepEqual(first.roles.map(({ roleId, status }) => ({ roleId, status })), [
    { roleId: 'strategy-finance', status: 'pending' },
    { roleId: 'technology-risk', status: 'pending' },
  ]);

  const second = createOperatingAdapterHandoff(input('record-required', {
    roles: [
      { roleId: 'strategy-finance', status: 'recorded', inputDigest: digest('a') },
      { roleId: 'technology-risk', status: 'pending', inputDigest: digest('b') },
    ],
  }));
  assert.deepEqual(second.next.map(({ role }) => role), ['technology-risk']);
});

test('semantic validation rejects every tampered capability binding', () => {
  const valid = createOperatingAdapterHandoff(input('record-required'));
  const mutate = (callback) => {
    const value = structuredClone(valid);
    callback(value);
    assert.throws(
      () => validateOperatingAdapterHandoffBindings(value),
      /operating-adapter-handoff/,
    );
  };
  mutate((value) => value.next[0].argv.splice(7, 1, 'CYCLE-999'));
  mutate((value) => value.next[0].argv.splice(9, 1, digest('f')));
  mutate((value) => value.next[0].argv.splice(11, 1, 'b'.repeat(43)));
  mutate((value) => value.next[0].argv.splice(13, 1, 'other-key'));
  mutate((value) => value.next[0].argv.splice(5, 1, 'technology-risk'));
  mutate((value) => {
    value.next[0].dispatch.rolePackPointer = '/data/rolePacks/technology-risk';
  });
  mutate((value) => {
    value.next[0].stdin.schemaPointer =
      '/data/rolePacks/technology-risk/roleBrief/output/jsonSchema';
  });
  mutate((value) => {
    value.next[0].stdin.maxBytes = 65536;
  });
});

test('semantic validation rejects invalid role and state combinations', () => {
  assert.throws(
    () => createOperatingAdapterHandoff(input('record-required', {
      roles: [
        { roleId: 'strategy-finance', status: 'recorded', inputDigest: digest('a') },
      ],
    })),
    /record-required needs at least one pending role/,
  );
  assert.throws(
    () => createOperatingAdapterHandoff(input('prepare-required', {
      phase: 'chair',
      roles: [{ roleId: 'technology-risk', status: 'awaiting-prepare', inputDigest: null }],
    })),
    /chair phase/,
  );
  assert.throws(
    () => createOperatingAdapterHandoff(input('prepare-required', {
      roles: [
        { roleId: 'strategy-finance', status: 'awaiting-prepare', inputDigest: null },
        { roleId: 'strategy-finance', status: 'awaiting-prepare', inputDigest: null },
      ],
    })),
    /roles must be unique/,
  );
});
