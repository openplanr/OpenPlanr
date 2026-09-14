// @planr-test-group serial
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildOperateExperienceTransportView,
  readOperateExperienceProjection,
  selectOperateExperienceSurface,
} from '../../lib/dashboard/operate-experience-reader.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fixture = JSON.parse(readFileSync(join(
  root,
  'conformance/fixtures/operating-runtime-v2/experience-bridge-valid.json',
), 'utf8'))['operate-experience-view'];
const HASH = `sha256:${'a'.repeat(64)}`;

function event(sequence) {
  return {
    eventId: `evt_perf_${String(sequence).padStart(5, '0')}`,
    sequence,
    type: 'cycle.started',
    entityId: 'cycle-00000001',
    actorKind: 'engine',
    actorId: 'openplanr',
    timestamp: '2026-08-12T08:00:00Z',
    correlationId: 'corr_perf_00000001',
    eventHash: HASH,
    change: { subjectKind: 'cycle', summary: 'Cycle state changed.' },
    why: 'Canonical replay event.',
    authority: null,
    evidenceRefIds: [],
    prior: { previousEventHash: sequence === 1 ? null : HASH, causationId: null },
    result: null,
    next: null,
    deepLinks: [],
    beforeAfter: null,
  };
}

function tenThousandEventView() {
  const base = {
    ...structuredClone(fixture),
    history: Array.from({ length: 10_000 }, (_, index) => event(index + 1)),
    eventHead: { sequence: 10_000, hash: HASH },
    replay: {
      ...structuredClone(fixture.replay),
      tail: {
        startSequence: 1,
        endSequence: 10_000,
        eventCount: 10_000,
        eventReplayIndexHash: HASH,
      },
      finalHead: { sequence: 10_000, hash: HASH },
      parityProof: {
        ...structuredClone(fixture.replay.parityProof),
        eventReplayIndexHash: HASH,
        finalEventHashMatches: true,
        stateParityVerified: false,
      },
    },
  };
  delete base.viewHash;
  return { ...base, viewHash: sha256Jcs(base) };
}

function measureLoadedRoute(current, binding, input, samples = 7) {
  const measurements = [];
  let response = null;
  for (let index = 0; index < samples; index += 1) {
    const started = process.cpuUsage();
    response = selectOperateExperienceSurface(current, { ...input, binding });
    const elapsed = process.cpuUsage(started);
    measurements.push((elapsed.user + elapsed.system) / 1_000);
  }
  measurements.sort((left, right) => left - right);
  return { response, ms: measurements[Math.floor(measurements.length / 2)] };
}

test('10,000-Event Today, update, navigation, replay, and memory stay within product budgets', {
  timeout: 30_000,
}, (context) => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'openplanr-operate-projection-'));
  const beforeHeap = process.memoryUsage().heapUsed;
  const source = tenThousandEventView();
  try {
    const projectionPath = join(temporaryRoot, 'operate', 'projections', 'experience-view.json');
    mkdirSync(dirname(projectionPath), { recursive: true });
    writeFileSync(projectionPath, JSON.stringify(source));
    assert.ok(
      readFileSync(projectionPath).byteLength > 4 * 1024 * 1024,
      'fixture must exercise the former 4MiB projection limit',
    );

    const readStarted = process.cpuUsage();
    const projection = readOperateExperienceProjection(temporaryRoot);
    const readElapsed = process.cpuUsage(readStarted);
    const projectionReadMs = (readElapsed.user + readElapsed.system) / 1_000;
    assert.equal(projection.available, true);
    assert.equal(projection.status, 'ready');
    assert.equal(projection.view.history.length, 10_000);

    const buildStarted = process.cpuUsage();
    const current = buildOperateExperienceTransportView(source);
    const buildElapsed = process.cpuUsage(buildStarted);
    const startupMs = (buildElapsed.user + buildElapsed.system) / 1_000;
    const binding = {
      actorId: current.actorId,
      scopeId: current.scopeId,
      domainId: current.domainId,
      domainVersion: current.domainVersion,
    };
    // Prime each loaded route enough for Node's optimizing compiler to settle so
    // the budget measures steady-state product work rather than JIT/GC timing.
    for (let pass = 0; pass < 3; pass += 1) {
      for (const surface of ['today', 'history', 'cycles']) {
        selectOperateExperienceSurface(current, { surface, binding });
      }
    }
    // The specification's 200ms target is explicitly for synchronous route work
    // after data is loaded. Measure process CPU rather than elapsed scheduler time
    // so parallel test workers cannot turn an unchanged selector into a false red.
    const todayRoute = measureLoadedRoute(current, binding, { surface: 'today' });
    const replayRoute = measureLoadedRoute(current, binding, { surface: 'history' });
    const cycleRoute = measureLoadedRoute(current, binding, { surface: 'cycles' });
    const updateRoute = measureLoadedRoute(current, binding, { surface: 'today' });
    const today = todayRoute.response;
    const history = replayRoute.response;
    const cycles = cycleRoute.response;
    const refreshed = updateRoute.response;
    const heapDeltaBytes = Math.max(0, process.memoryUsage().heapUsed - beforeHeap);

    context.diagnostic(JSON.stringify({
      projectionReadMs,
      startupMs,
      todayMs: todayRoute.ms,
      updateMs: updateRoute.ms,
      navigationMs: cycleRoute.ms,
      replayMs: replayRoute.ms,
      heapDeltaBytes,
    }));

    assert.equal(today.ok, true);
    assert.equal(history.ok, true);
    assert.equal(history.data.history.length, 10_000);
    assert.equal(cycles.ok, true);
    assert.equal(refreshed.viewHash, current.viewHash);
    assert.ok(projectionReadMs <= 2_000, `projection read ${projectionReadMs.toFixed(1)}ms exceeds 2000ms`);
    assert.ok(startupMs <= 2_000, `startup ${startupMs.toFixed(1)}ms exceeds 2000ms`);
    assert.ok(todayRoute.ms <= 200, `Today ${todayRoute.ms.toFixed(1)}ms exceeds 200ms`);
    assert.ok(updateRoute.ms <= 200, `update ${updateRoute.ms.toFixed(1)}ms exceeds 200ms`);
    assert.ok(cycleRoute.ms <= 200, `navigation ${cycleRoute.ms.toFixed(1)}ms exceeds 200ms`);
    assert.ok(replayRoute.ms <= 300, `replay ${replayRoute.ms.toFixed(1)}ms exceeds 300ms`);
    assert.ok(heapDeltaBytes <= 128 * 1024 * 1024, `heap delta ${heapDeltaBytes} exceeds 128MiB`);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
