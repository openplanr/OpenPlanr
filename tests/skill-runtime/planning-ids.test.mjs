import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const helper = resolve(import.meta.dirname, '../../skills/planr-plan/scripts/planning-ids.mjs');

function run(cwd, ...args) {
  return spawnSync(process.execPath, [helper, ...args, '--stories', '1', '--tasks', '1'], {
    cwd,
    encoding: 'utf8',
  });
}

function workspace() {
  return realpathSync(mkdtempSync(join(tmpdir(), 'planning-ids-')));
}

/** Mirrors `openplanr init`: a project config and an empty specs folder under `<agile>/specs`. */
function initializedProject(agile = '.planr') {
  const project = workspace();
  mkdirSync(join(project, '.planr'), { recursive: true });
  writeFileSync(
    join(project, '.planr/config.json'),
    JSON.stringify({ projectName: 'fixture', outputPaths: { agile } }),
  );
  const specs = join(project, agile, 'specs');
  mkdirSync(specs, { recursive: true });
  return { project, specs };
}

function plannedProject() {
  const { project, specs } = initializedProject();
  mkdirSync(join(specs, 'SPEC-001-billing/stories'), { recursive: true });
  mkdirSync(join(specs, 'SPEC-001-billing/tasks'), { recursive: true });
  writeFileSync(join(specs, 'SPEC-001-billing/stories/US-012-invoice.md'), '');
  writeFileSync(join(specs, 'SPEC-001-billing/tasks/T-052-render.md'), '');
  return { project, specs };
}

for (const mode of ['preview', 'reserve']) {
  const flags = mode === 'preview' ? ['--preview'] : [];

  test(`${mode} rejects a missing root without creating it`, () => {
    const cwd = workspace();
    const root = join(cwd, 'missing/.planr/specs');
    const result = run(cwd, '--root', root, ...flags);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      new RegExp(`Planning root ${root} is not inside an OpenPlanr project: no .planr/config.json`),
    );
    assert.deepEqual(readdirSync(cwd), []);
  });

  test(`${mode} rejects the default root when the current directory has no .planr`, () => {
    const cwd = workspace();
    const result = run(cwd, ...flags);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /is not inside an OpenPlanr project/);
    assert.deepEqual(readdirSync(cwd), []);
  });

  test(`${mode} rejects a root that is not a planning folder`, () => {
    const { project: cwd } = initializedProject();
    mkdirSync(join(cwd, 'src'));
    writeFileSync(join(cwd, 'src/index.ts'), '');
    const directory = run(cwd, '--root', 'src', ...flags);
    assert.equal(directory.status, 1);
    assert.match(
      directory.stderr,
      new RegExp(
        `Planning root ${join(cwd, 'src')} is not the planning folder configured by ${join(cwd, '.planr/config.json')}, which expects ${join(cwd, '.planr/specs')}`,
      ),
    );
    assert.deepEqual(readdirSync(join(cwd, 'src')), ['index.ts']);

    const { project, specs } = initializedProject();
    rmSync(specs, { recursive: true });
    writeFileSync(specs, '');
    const file = run(project, '--root', specs, ...flags);
    assert.equal(file.status, 1);
    assert.match(
      file.stderr,
      new RegExp(
        `Planning root ${specs} is not a directory; ${join(project, '.planr/config.json')}`,
      ),
    );
  });

  test(`${mode} rejects --root . at a repository root whose planning folder is hidden`, () => {
    const { project, specs } = plannedProject();
    const result = run(project, '--root', '.', ...flags);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      new RegExp(
        `Planning root ${project} is not the planning folder configured by .*, which expects ${specs}`,
      ),
    );
    assert.deepEqual(readdirSync(project), ['.planr']);
    assert.deepEqual(readdirSync(specs), ['SPEC-001-billing']);
  });

  test(`${mode} rejects a configured planning folder that is missing without creating it`, () => {
    const { project, specs } = initializedProject();
    rmSync(specs, { recursive: true });
    const config = join(project, '.planr/config.json');
    const result = run(project, ...flags);
    assert.equal(result.status, 1);
    assert.ok(
      result.stderr.includes(
        `Planning root ${specs} does not exist; ${config} expects it. Create it with \`mkdir -p ${specs}\`, or fix outputPaths.agile in ${config}.`,
      ),
      result.stderr,
    );
    assert.deepEqual(readdirSync(join(project, '.planr')), ['config.json']);
  });

  test(`${mode} allocates US-001 and T-001 in a freshly initialized project`, () => {
    const { project, specs } = initializedProject();
    const result = run(project, ...flags);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).ids, { SPEC: [], US: ['US-001'], T: ['T-001'] });
    const written = readdirSync(specs);
    if (mode === 'preview') assert.deepEqual(written, []);
    else {
      assert.deepEqual(written, ['.id-sequence.json']);
      const sequence = JSON.parse(readFileSync(join(specs, '.id-sequence.json'), 'utf8'));
      assert.deepEqual(sequence.next, { SPEC: 1, US: 2, T: 2 });
    }
  });

  test(`${mode} rejects .planr/specs when the project config moves the planning path`, () => {
    const { project, specs } = initializedProject('planning');
    mkdirSync(join(project, '.planr/specs'));
    const result = run(project, ...flags);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      new RegExp(
        `Planning root ${join(project, '.planr/specs')} is not the planning folder configured by ${join(project, '.planr/config.json')}, which expects ${specs}`,
      ),
    );
    assert.deepEqual(readdirSync(join(project, '.planr/specs')), []);
    assert.equal(run(project, '--root', 'planning/specs', ...flags).status, 0);
  });
}

test('preview allocates the next IDs from nested planning folders without writing', () => {
  const { project, specs } = plannedProject();
  const result = run(project, '--preview');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).ids, { SPEC: [], US: ['US-013'], T: ['T-053'] });
  assert.deepEqual(readdirSync(specs), ['SPEC-001-billing']);
});

test('reserve allocates the next IDs and advances the stored sequence', () => {
  const { project, specs } = plannedProject();
  const first = run(project, '--root', specs);
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(JSON.parse(first.stdout).ids, { SPEC: [], US: ['US-013'], T: ['T-053'] });
  const sequence = JSON.parse(readFileSync(join(specs, '.id-sequence.json'), 'utf8'));
  assert.deepEqual(sequence.next, { SPEC: 2, US: 14, T: 54 });
  const second = run(project);
  assert.deepEqual(JSON.parse(second.stdout).ids, { SPEC: [], US: ['US-014'], T: ['T-054'] });
});
