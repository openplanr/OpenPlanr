import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { appendProvenanceEvent, createProvenanceEvent } from '../../lib/pipeline/provenance.mjs';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SECRET = 'SECRET_INVALID_RECORD_BODY';

function project() {
  const root = mkdtempSync(join(tmpdir(), 'planr-provenance-'));
  mkdirSync(join(root, '.planr'), { recursive: true });
  return {
    root,
    target: join(root, '.planr', 'provenance.jsonl'),
    stage: join(root, '.planr', 'provenance.jsonl.stage'),
    lock: join(root, '.planr', 'provenance.lock'),
  };
}

function provenanceEvent(root, eventId, overrides = {}) {
  return {
    ...createProvenanceEvent({
      projectRoot: root,
      artifactId: `SPEC-${eventId}`,
      artifactPath: join(root, '.planr', 'specs', `${eventId}.md`),
      operation: 'created',
      product: 'planr-pipeline',
      version: '0.42.0',
      runtime: 'codex',
      phase: 'planning',
      runId: `run-${eventId}`,
      eventId,
      timestamp: '2026-08-23T00:00:00.000Z',
    }),
    ...overrides,
  };
}

function row(value) {
  return `${JSON.stringify(value)}\n`;
}

function failureFor(fn) {
  let failure;
  assert.throws(fn, (error) => {
    failure = error;
    return true;
  });
  return failure;
}

function runAppendProcess(root, eventId, { crashAt = '', holdLock = false } = {}) {
  const source = String.raw`
    import { appendProvenanceEvent, createProvenanceEvent } from './lib/pipeline/provenance.mjs';
    import { join } from 'node:path';
    const root = process.env.PROVENANCE_ROOT;
    const eventId = process.env.PROVENANCE_EVENT_ID;
    const event = createProvenanceEvent({
      projectRoot: root,
      artifactId: 'SPEC-' + eventId,
      artifactPath: join(root, '.planr', 'specs', eventId + '.md'),
      operation: 'created',
      product: 'planr-pipeline',
      version: '0.42.0',
      runtime: 'codex',
      phase: 'planning',
      runId: 'run-' + eventId,
      eventId,
      timestamp: '2026-08-23T00:00:00.000Z',
    });
    const crashAt = process.env.PROVENANCE_CRASH_AT;
    const hooks = {
      afterStage() {
        if (process.env.PROVENANCE_HOLD_LOCK === '1') {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
        }
        if (crashAt === 'afterStage') process.exit(71);
      },
      afterCommit() {
        if (crashAt === 'afterCommit') process.exit(72);
      },
    };
    appendProvenanceEvent(root, event, { hooks });
  `;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        PROVENANCE_ROOT: root,
        PROVENANCE_EVENT_ID: eventId,
        PROVENANCE_CRASH_AT: crashAt,
        PROVENANCE_HOLD_LOCK: holdLock ? '1' : '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

test('invalid provenance history fails closed at the exact safe record context', () => {
  const fixtureProject = project();
  const first = provenanceEvent(fixtureProject.root, 'event-first');
  const middle = provenanceEvent(fixtureProject.root, 'event-middle');
  const last = provenanceEvent(fixtureProject.root, 'event-last');
  const invalid = provenanceEvent(fixtureProject.root, 'event-invalid', {
    producer: {
      product: 'planr-pipeline',
      version: SECRET,
      runtime: 'codex',
      phase: 'planning',
    },
  });
  const cases = [
    {
      name: 'invalid first row',
      bytes: row(invalid) + row(middle) + row(last),
      line: 1,
      reason: 'schema-invalid',
      declared: '1.0.0',
    },
    {
      name: 'invalid middle row',
      bytes: row(first) + row(invalid) + row(last),
      line: 2,
      reason: 'schema-invalid',
      declared: '1.0.0',
    },
    {
      name: 'invalid last row',
      bytes: row(first) + row(middle) + row(invalid),
      line: 3,
      reason: 'schema-invalid',
      declared: '1.0.0',
    },
    {
      name: 'malformed row',
      bytes: row(first) + `{"schema_version":"1.0.0","secret":"${SECRET}"\n`,
      line: 2,
      reason: 'malformed-json',
      declared: null,
    },
    {
      name: 'truncated tail',
      bytes: row(first) + JSON.stringify(middle),
      line: 2,
      reason: 'truncated-tail',
      declared: null,
    },
    {
      name: 'unknown declared version',
      bytes: row(first) + row({ ...middle, schema_version: '9.9.9' }),
      line: 2,
      reason: 'unsupported-version',
      declared: '9.9.9',
    },
    {
      name: 'mixed declared versions',
      bytes: row(first) + row({ ...middle, schema_version: '2.0.0' }) + row(last),
      line: 2,
      reason: 'unsupported-version',
      declared: '2.0.0',
    },
    {
      name: 'duplicate event identity',
      bytes: row(first) + row(first),
      line: 2,
      reason: 'duplicate-identity',
      declared: '1.0.0',
    },
  ];

  for (const fixture of cases) {
    writeFileSync(fixtureProject.target, fixture.bytes, { mode: 0o600 });
    const before = readFileSync(fixtureProject.target);
    const failure = failureFor(() =>
      appendProvenanceEvent(
        fixtureProject.root,
        provenanceEvent(fixtureProject.root, `new-${fixture.name.replaceAll(' ', '-')}`),
      ),
    );
    assert.equal(failure.code, 'E_PROVENANCE_HISTORY_INVALID', fixture.name);
    assert.equal(failure.details?.retryable, false, fixture.name);
    assert.deepEqual(
      failure.details?.context,
      {
        line: fixture.line,
        record: fixture.line,
        reason: fixture.reason,
        declaredSchemaVersion: fixture.declared,
      },
      fixture.name,
    );
    assert.equal(failure.details?.repairCommand, 'planr doctor --json', fixture.name);
    assert.doesNotMatch(JSON.stringify(failure.toJSON()), new RegExp(SECRET), fixture.name);
    assert.equal(
      JSON.stringify(failure.toJSON()).includes(fixtureProject.root),
      false,
      fixture.name,
    );
    assert.deepEqual(readFileSync(fixtureProject.target), before, fixture.name);
    assert.equal(existsSync(fixtureProject.stage), false, fixture.name);
    assert.equal(existsSync(fixtureProject.lock), false, fixture.name);
  }
});

test('valid append preserves historical bytes and exact replay is idempotent', () => {
  const fixtureProject = project();
  const historical = provenanceEvent(fixtureProject.root, 'event-history');
  const historicalBytes = Buffer.from(`\n${row(historical)}`, 'utf8');
  writeFileSync(fixtureProject.target, historicalBytes, { mode: 0o600 });
  const appended = provenanceEvent(fixtureProject.root, 'event-appended');

  assert.equal(appendProvenanceEvent(fixtureProject.root, appended), fixtureProject.target);
  const committed = readFileSync(fixtureProject.target);
  assert.deepEqual(committed.subarray(0, historicalBytes.length), historicalBytes);
  assert.equal(committed.toString('utf8').split('\n').filter(Boolean).length, 2);

  const reorderedReplay = Object.fromEntries(Object.entries(appended).reverse());
  assert.equal(appendProvenanceEvent(fixtureProject.root, reorderedReplay), fixtureProject.target);
  assert.deepEqual(readFileSync(fixtureProject.target), committed);

  const divergent = { ...appended, artifact_id: 'SPEC-divergent' };
  const failure = failureFor(() => appendProvenanceEvent(fixtureProject.root, divergent));
  assert.equal(failure.code, 'E_PROVENANCE_REPLAY_DIVERGENT');
  assert.equal(failure.details?.retryable, false);
  assert.deepEqual(readFileSync(fixtureProject.target), committed);
});

test('empty provenance history accepts one durable event', () => {
  const fixtureProject = project();
  const appended = provenanceEvent(fixtureProject.root, 'event-empty');
  assert.equal(appendProvenanceEvent(fixtureProject.root, appended), fixtureProject.target);
  assert.deepEqual(readFileSync(fixtureProject.target, 'utf8'), row(appended));
});

test('a generation change cannot be overwritten by a staged append', () => {
  const fixtureProject = project();
  const baseline = provenanceEvent(fixtureProject.root, 'event-baseline');
  const external = provenanceEvent(fixtureProject.root, 'event-external');
  const appended = provenanceEvent(fixtureProject.root, 'event-generation');
  writeFileSync(fixtureProject.target, row(baseline), { mode: 0o600 });

  const failure = failureFor(() =>
    appendProvenanceEvent(fixtureProject.root, appended, {
      hooks: {
        afterStage() {
          writeFileSync(fixtureProject.target, row(external), { mode: 0o600 });
        },
      },
    }),
  );
  assert.equal(failure.code, 'E_PROVENANCE_GENERATION_CONFLICT');
  const changedBytes = readFileSync(fixtureProject.target);
  assert.deepEqual(changedBytes, Buffer.from(row(external), 'utf8'));
  assert.equal(existsSync(fixtureProject.stage), true);

  const recoveryFailure = failureFor(() =>
    appendProvenanceEvent(
      fixtureProject.root,
      provenanceEvent(fixtureProject.root, 'event-after-conflict'),
    ),
  );
  assert.equal(recoveryFailure.code, 'E_PROVENANCE_RECOVERY_REQUIRED');
  assert.deepEqual(readFileSync(fixtureProject.target), changedBytes);
});

test('concurrent appenders serialize without losing or duplicating valid events', async () => {
  const fixtureProject = project();
  const eventIds = Array.from({ length: 12 }, (_, index) => `event-concurrent-${index}`);
  const results = await Promise.all(
    eventIds.map((eventId) => runAppendProcess(fixtureProject.root, eventId, { holdLock: true })),
  );
  assert.deepEqual(
    results.map(({ status }) => status),
    Array(eventIds.length).fill(0),
    results.map(({ stderr }) => stderr).join('\n'),
  );
  const records = readFileSync(fixtureProject.target, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(records.length, eventIds.length);
  assert.deepEqual(records.map(({ event_id: eventId }) => eventId).sort(), eventIds.sort());
  assert.equal(new Set(records.map(({ event_id: eventId }) => eventId)).size, eventIds.length);
  assert.equal(existsSync(fixtureProject.stage), false);
  assert.equal(existsSync(fixtureProject.lock), false);
});

for (const crashAt of ['afterStage', 'afterCommit']) {
  test(`a process crash ${crashAt} recovers once without duplicate provenance`, async () => {
    const fixtureProject = project();
    const eventId = `event-crash-${crashAt}`;
    const crashed = await runAppendProcess(fixtureProject.root, eventId, { crashAt });
    assert.equal(crashed.status, crashAt === 'afterStage' ? 71 : 72, crashed.stderr);
    assert.equal(existsSync(fixtureProject.lock), true);
    assert.equal(existsSync(fixtureProject.stage), crashAt === 'afterStage');

    const event = provenanceEvent(fixtureProject.root, eventId);
    assert.equal(appendProvenanceEvent(fixtureProject.root, event), fixtureProject.target);
    const records = readFileSync(fixtureProject.target, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(records.length, 1);
    assert.deepEqual(records[0], event);
    assert.equal(existsSync(fixtureProject.stage), false);
    assert.equal(existsSync(fixtureProject.lock), false);
  });
}
