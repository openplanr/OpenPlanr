import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { selectOperateExperienceSurface } from '../../lib/dashboard/operate-experience-reader.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';
import { resolveWorkspaceDependencyRoot } from '../helpers/workspace-dependency.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const fixture = JSON.parse(
  readFileSync(
    join(root, 'conformance/fixtures/operating-runtime-v2/experience-bridge-valid.json'),
    'utf8',
  ),
)['operate-experience-view'];

function cycle(cycleId, updatedAt) {
  return {
    cycleId,
    state: 'approved',
    health: 'normal',
    focus: [`Focus ${cycleId}`],
    createdAt: '2026-08-11T07:00:00Z',
    updatedAt,
    stages: ['observe', 'understand', 'decide', 'govern', 'act', 'verify', 'learn'].map(
      (id, index) => ({
        id,
        state: index === 4 ? 'current' : index < 4 ? 'complete' : 'waiting',
        reason: null,
        inputArtifactIds: [],
        outputArtifactIds: [],
        gates: [],
        evidenceGapIds: [],
        uncertaintyIds: [],
        persistentActionIds: [],
      }),
    ),
    assignments: [],
    lensAbsences: [],
    executiveBoard: null,
    dependencies: [],
    blockers: [],
    persistentActionIds: [],
    replayCheckpoint: null,
    deepLink: `#/operate/cycles/${cycleId}`,
  };
}

function todayView() {
  const cycleOwnerFirst = cycle('cycle-z', '2026-08-11T09:00:00Z');
  const cycleRequested = cycle('cycle-a', '2026-08-11T08:00:00Z');
  const base = {
    ...structuredClone(fixture),
    attention: [
      {
        attentionId: 'attention-owner-first',
        kind: 'decision',
        subjectId: 'decision-z',
        priority: 100,
        title: 'Owner-first decision',
        whyNow: 'The certified owner placed this first.',
        consequence: 'Client ranking would change custody.',
        state: 'proposed',
        dueAt: null,
        evidenceRefIds: [],
      },
      {
        attentionId: 'attention-higher-number-second',
        kind: 'approval',
        subjectId: 'approval-a',
        priority: 900,
        title: 'Higher number remains second',
        whyNow: 'The owner array is already certified.',
        consequence: 'The client must preserve it.',
        state: 'pending',
        dueAt: null,
        evidenceRefIds: [],
      },
    ],
    cycles: [cycleOwnerFirst, cycleRequested],
    allowedActions: [
      {
        subjectId: 'review-z',
        action: {
          tool: 'operate.cycle.get',
          arguments: { cycleId: cycleRequested.cycleId },
          label: 'Owner-first continuation',
          effect: 'read-only',
        },
      },
      {
        subjectId: 'cycle-a',
        action: {
          tool: 'operate.cycle.get',
          arguments: { cycleId: cycleRequested.cycleId },
          label: 'Second continuation',
          effect: 'read-only',
        },
      },
      {
        subjectId: 'cycle-a',
        action: {
          tool: 'operate.cycle.get',
          arguments: { cycleId: cycleRequested.cycleId },
          label: 'Second continuation',
          effect: 'read-only',
        },
      },
    ],
  };
  delete base.viewHash;
  return { ...base, viewHash: sha256Jcs(base) };
}

function binding(view) {
  return {
    actorId: view.actorId,
    scopeId: view.scopeId,
    domainId: view.domainId,
    domainVersion: view.domainVersion,
  };
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

test('Today preserves certified order and continuation while selecting exact Cycle custody', () => {
  const view = todayView();
  const selected = selectOperateExperienceSurface(view, {
    surface: 'today',
    cycleId: 'cycle-a',
    binding: binding(view),
  });
  assert.equal(selected.ok, true);
  assert.equal(selected.data.activeCycle.cycleId, 'cycle-a');
  assert.deepEqual(selected.data.attention, view.attention);
  assert.deepEqual(selected.data.allowedActions, view.allowedActions);
  assert.equal(selected.data.attention[0].priority, 100);
  assert.equal(selected.data.allowedActions[0].subjectId, 'review-z');
  assert.equal(selected.data.allowedActions.length, 3);
  assert.deepEqual(selected.data.allowedActions[1], selected.data.allowedActions[2]);
  assert.deepEqual(selected.eventHead, view.eventHead);
  assert.equal(selected.viewHash, view.viewHash);

  const ownerDefault = selectOperateExperienceSurface(view, {
    surface: 'today',
    binding: binding(view),
  });
  assert.equal(ownerDefault.ok, true);
  assert.equal(ownerDefault.data.activeCycle.cycleId, 'cycle-z');
});

test('Today exact-Cycle and foreign-binding requests fail closed without leaking custody', () => {
  const view = todayView();
  const missing = selectOperateExperienceSurface(view, {
    surface: 'today',
    cycleId: 'cycle-private-missing',
    binding: binding(view),
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.reasonCode, 'OPERATE_SUBJECT_NOT_FOUND');
  assert.equal(JSON.stringify(missing).includes('cycle-private-missing'), false);

  const foreign = selectOperateExperienceSurface(view, {
    surface: 'today',
    cycleId: 'cycle-a',
    binding: { ...binding(view), actorId: 'foreign-observer' },
  });
  assert.equal(foreign.ok, false);
  assert.equal(foreign.error.reasonCode, 'OPERATE_BINDING_MISMATCH');
  assert.equal(JSON.stringify(foreign).includes(view.actorId), false);

  const noCycle = todayView();
  noCycle.cycles = [];
  delete noCycle.viewHash;
  noCycle.viewHash = sha256Jcs(noCycle);
  const required = selectOperateExperienceSurface(noCycle, {
    surface: 'today',
    cycleId: 'cycle-a',
    binding: binding(noCycle),
  });
  assert.equal(required.ok, false);
  assert.equal(required.error.reasonCode, 'OPERATE_SUBJECT_NOT_FOUND');
});

test('Today selector contains no client ordering or continuation rewrite', () => {
  const source = readFileSync(join(root, 'lib/dashboard/operate-experience-reader.mjs'), 'utf8');
  const todaySelector = source.slice(
    source.indexOf('function surfaceData('),
    source.indexOf('function searchView('),
  );
  assert.doesNotMatch(todaySelector, /\.sort\s*\(/u);
  assert.doesNotMatch(todaySelector, /\b(?:dedupe|normalize|rank)\w*\s*\(/iu);
  assert.match(todaySelector, /attention:\s*view\.attention/u);
  assert.match(todaySelector, /allowedActions:\s*view\.allowedActions/u);
});

test('packed and installed Today reader matches source bytes and behavior', {
  timeout: 120_000,
}, async () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'planr-today-pack-'));
  try {
    const packed = spawnSync(
      'npm',
      [
        'pack',
        '--ignore-scripts',
        '--json',
        '--cache',
        join(temporaryRoot, 'npm-cache'),
        '--pack-destination',
        temporaryRoot,
      ],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(packed.status, 0, packed.stderr);
    const [{ filename }] = JSON.parse(packed.stdout);
    const installedRoot = join(temporaryRoot, 'consumer', 'node_modules', 'planr-pipeline');
    mkdirSync(installedRoot, { recursive: true });
    const extracted = spawnSync(
      'tar',
      ['-xzf', join(temporaryRoot, filename), '-C', installedRoot, '--strip-components=1'],
      { encoding: 'utf8' },
    );
    assert.equal(extracted.status, 0, extracted.stderr);
    cpSync(
      resolveWorkspaceDependencyRoot('@noble/hashes'),
      join(temporaryRoot, 'consumer', 'node_modules', '@noble', 'hashes'),
      { recursive: true },
    );

    const relativeReader = 'lib/dashboard/operate-experience-reader.mjs';
    assert.equal(sha256(join(installedRoot, relativeReader)), sha256(join(root, relativeReader)));
    const installed = await import(pathToFileURL(join(installedRoot, relativeReader)).href);
    const view = todayView();
    const input = { surface: 'today', cycleId: 'cycle-a', binding: binding(view) };
    assert.deepEqual(
      installed.selectOperateExperienceSurface(view, input),
      selectOperateExperienceSurface(view, input),
    );
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
