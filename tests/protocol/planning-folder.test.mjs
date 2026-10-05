import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  foreignPlanningFolderSigns,
  planningFolderConflict,
} from '../../packages/protocol/src/planning-folder.mjs';

function project(t, files = []) {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-planning-folder-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), '\n');
  }
  return root;
}

test('a clean repository has no planning folder conflict', (t) => {
  const root = project(t, ['README.md']);
  assert.deepEqual(foreignPlanningFolderSigns(root), []);
  assert.equal(planningFolderConflict(root), null);
});

test('an empty planning folder is still open to OpenPlanr', (t) => {
  const root = project(t);
  mkdirSync(join(root, '.planr'));
  assert.equal(planningFolderConflict(root), null);
});

test("OpenPlanr's own planning folder is never foreign, whatever else it holds", (t) => {
  const root = project(t, [
    '.planr/config.json',
    '.planr/board.html',
    '.planr/tasks/TASK-001-ship-goal.md',
  ]);
  assert.deepEqual(foreignPlanningFolderSigns(root), []);
  assert.equal(planningFolderConflict(root), null);
});

test('a folder OpenPlanr did not create is refused with what was found and what to do', (t) => {
  const root = project(t, [
    '.planr/planr.config.json',
    '.planr/board.html',
    '.planr/tasks/launch-goal.md',
    '.planr/plans/q4-goal.md',
  ]);
  const conflict = planningFolderConflict(root);
  assert.equal(conflict?.code, 'E_PLANNING_FOLDER_FOREIGN');
  assert.deepEqual(conflict.signs, [
    'planr.config.json',
    'board.html',
    '*-goal.md files in tasks',
    '*-goal.md files in plans',
  ]);
  assert.match(conflict.problem, /wasn't created by OpenPlanr/u);
  assert.match(conflict.problem, /planr\.config\.json, board\.html/u);
  assert.match(conflict.problem, /OpenPlanr wrote nothing there/u);
  assert.match(conflict.fix, /^Move or rename that folder/u);
  // The CLI redacts slash-separated text as a path, so the explanation must not need one.
  assert.doesNotMatch(`${conflict.problem} ${conflict.fix}`, /\//u);
});

test('each sign is enough on its own', (t) => {
  for (const [file, sign] of [
    ['.planr/planr.config.json', 'planr.config.json'],
    ['.planr/board.html', 'board.html'],
    ['.planr/tasks/a-goal.md', '*-goal.md files in tasks'],
    ['.planr/plans/b-goal.md', '*-goal.md files in plans'],
  ]) {
    const root = project(t, [file]);
    assert.deepEqual(foreignPlanningFolderSigns(root), [sign], file);
  }
});

test('task and plan folders without goal files are not a sign', (t) => {
  const root = project(t, ['.planr/tasks/TASK-001-setup.md', '.planr/plans/notes.md']);
  assert.equal(planningFolderConflict(root), null);
});
