import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  assertCadenceCannotMutate,
  computeNextDueDate,
  OPERATING_CADENCES,
} from '../../lib/operate/cadence.mjs';
import { assertProtocolArtifact } from '../../lib/protocol/contracts.mjs';
import {
  OperatingAssetGenerationError,
  renderOperatingAssets,
  renderOperatingCadenceDocs,
  runOperatingAssetGenerator,
} from '../../scripts/generate-operating-assets.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const CADENCE_DOC = 'docs/generated/operating-cadence.md';

// The three generated runtime guidance assets the skill-first framing must reach.
const RUNTIME_GUIDANCE_TARGETS = [
  'adapters/codex/skills/planr-operate/SKILL.md',
  'adapters/cursor/rules/openplanr-operate.mdc',
  'commands/operate.md',
];

// Every file renderOperatingAssets reads from disk, so the drift machinery can run
// against an isolated projectRoot. Mirrors the lens-agent generation test.
const SEED_FILES = [
  'package.json',
  'registry/adapters.json',
  'registry/operating-roles.json',
  'registry/operating-providers.json',
  'templates/runtime/planr-operate-skill.md.tpl',
  'templates/runtime/planr-operate-cursor.mdc.tpl',
  'templates/runtime/planr-operate-command.md.tpl',
  'templates/runtime/operating-lens-agent.md.tpl',
];

function seedProjectRoot() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'planr-cadence-'));
  for (const rel of SEED_FILES) {
    const target = join(projectRoot, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(join(root, rel), 'utf8'), 'utf8');
  }
  return projectRoot;
}

function readFixture(name) {
  return JSON.parse(
    readFileSync(join(root, 'conformance/fixtures/operating-board', name), 'utf8'),
  );
}

// --- FR8: cadence computes due dates without executing anything ---------------

test('manual cadence never computes a due date and echoes lastRunAt', () => {
  const withRun = computeNextDueDate('manual', '2026-07-24T09:00:00Z', '2026-07-31T09:00:00Z');
  assert.equal(withRun.cadence, 'manual');
  assert.equal(withRun.lastRunAt, '2026-07-24T09:00:00Z');
  assert.equal(withRun.nextDueAt, null);

  const firstRun = computeNextDueDate('manual', null, '2026-07-31T09:00:00Z');
  assert.equal(firstRun.lastRunAt, null);
  assert.equal(firstRun.nextDueAt, null);

  // Both validate against the v1.3 cadence-status contract.
  assertProtocolArtifact('operating-cadence-status', withRun, { protocolVersion: '1.3.0' });
  assertProtocolArtifact('operating-cadence-status', firstRun, { protocolVersion: '1.3.0' });
});

test('weekly cadence adds seven days and matches the canonical fixture', () => {
  const fixture = readFixture('cadence-weekly-due.json');
  const result = computeNextDueDate('weekly', fixture.lastRunAt, '2026-07-25T00:00:00Z');
  assert.equal(result.cadence, 'weekly');
  assert.equal(result.nextDueAt, fixture.nextDueAt); // 2026-07-24 + 7d -> 2026-07-31
  assert.deepEqual(result, fixture);
  assertProtocolArtifact('operating-cadence-status', result, { protocolVersion: '1.3.0' });
});

test('weekly cadence with no prior run is due immediately at now', () => {
  const result = computeNextDueDate('weekly', null, '2026-07-31T09:00:00Z');
  assert.equal(result.lastRunAt, null);
  assert.equal(result.nextDueAt, '2026-07-31T09:00:00Z');
  assertProtocolArtifact('operating-cadence-status', result, { protocolVersion: '1.3.0' });
});

test('monthly cadence adds one calendar month and matches the canonical fixture', () => {
  const fixture = readFixture('cadence-monthly-due.json');
  const result = computeNextDueDate('monthly', fixture.lastRunAt, '2026-07-02T00:00:00Z');
  assert.equal(result.nextDueAt, fixture.nextDueAt); // 2026-07-01 -> 2026-08-01
  assert.deepEqual(result, fixture);
  assertProtocolArtifact('operating-cadence-status', result, { protocolVersion: '1.3.0' });
});

test('monthly cadence with no prior run is due immediately at now', () => {
  const result = computeNextDueDate('monthly', null, '2026-07-31T09:00:00Z');
  assert.equal(result.lastRunAt, null);
  assert.equal(result.nextDueAt, '2026-07-31T09:00:00Z');
  assertProtocolArtifact('operating-cadence-status', result, { protocolVersion: '1.3.0' });
});

test('monthly cadence clamps to the last day of a shorter target month', () => {
  // Jan 31 + 1 month -> Feb 28 in a common year.
  const common = computeNextDueDate('monthly', '2026-01-31T09:00:00Z', '2026-01-31T09:00:00Z');
  assert.equal(common.nextDueAt, '2026-02-28T09:00:00Z');

  // Jan 31 + 1 month -> Feb 29 in a leap year (clamp uses real month length).
  const leap = computeNextDueDate('monthly', '2028-01-31T00:00:00Z', '2028-01-31T00:00:00Z');
  assert.equal(leap.nextDueAt, '2028-02-29T00:00:00Z');

  // Year rollover keeps day-of-month and time.
  const rollover = computeNextDueDate('monthly', '2026-12-15T09:00:00Z', '2026-12-15T09:00:00Z');
  assert.equal(rollover.nextDueAt, '2027-01-15T09:00:00Z');

  for (const value of [common, leap, rollover]) {
    assertProtocolArtifact('operating-cadence-status', value, { protocolVersion: '1.3.0' });
  }
});

test('computeNextDueDate is pure: identical inputs yield identical output', () => {
  const inputs = ['weekly', '2026-03-10T12:34:56Z', '2026-03-11T00:00:00Z'];
  assert.deepEqual(computeNextDueDate(...inputs), computeNextDueDate(...inputs));

  const monthly = ['monthly', '2026-03-31T00:00:00.500Z', '2026-04-01T00:00:00Z'];
  assert.deepEqual(computeNextDueDate(...monthly), computeNextDueDate(...monthly));
  // A non-zero millisecond fraction is preserved and stays schema-valid.
  assert.equal(computeNextDueDate(...monthly).nextDueAt, '2026-04-30T00:00:00.500Z');
});

test('computeNextDueDate rejects unknown cadence and malformed timestamps', () => {
  assert.throws(
    () => computeNextDueDate('daily', null, '2026-07-31T09:00:00Z'),
    (error) => error.code === 'E_OPERATE_CADENCE_INVALID',
  );
  assert.throws(
    () => computeNextDueDate('weekly', null, 'not-a-date'),
    (error) => error.code === 'E_OPERATE_CADENCE_TIMESTAMP',
  );
  assert.throws(
    () => computeNextDueDate('weekly', '2026/07/24', '2026-07-31T09:00:00Z'),
    (error) => error.code === 'E_OPERATE_CADENCE_TIMESTAMP',
  );
});

test('cadence computation structurally cannot accept an action or route', () => {
  // The guard is a documented no-op; the real guarantee is the arity.
  assert.equal(assertCadenceCannotMutate(), true);
  // (cadence, lastRunAt, now) — exactly three value inputs, none an action/route.
  assert.equal(computeNextDueDate.length, 3);
  assert.deepEqual([...OPERATING_CADENCES], ['manual', 'weekly', 'monthly']);
});

// --- Generated cadence guidance participates in drift detection ---------------

test('renderOperatingAssets folds the cadence doc into the drift-checked map', () => {
  const assets = renderOperatingAssets();
  assert.ok(
    Object.prototype.hasOwnProperty.call(assets, CADENCE_DOC),
    'renderOperatingAssets includes the cadence guidance doc',
  );
  assert.equal(assets[CADENCE_DOC], renderOperatingCadenceDocs());
  // Same drift machinery as the pre-existing targets: on-disk must match generated.
  assert.equal(
    readFileSync(join(root, CADENCE_DOC), 'utf8'),
    assets[CADENCE_DOC],
    `${CADENCE_DOC} must be regenerated with npm run generate:operating-assets`,
  );
});

test('cadence guidance is static and provider-free (reads no per-project state)', () => {
  const doc = renderOperatingCadenceDocs();
  assert.match(doc, /<!-- Generated by scripts\/generate-operating-assets\.mjs\. Do not edit\. -->/u);
  assert.match(doc, /Computing a\s+due date is a pure calculation/u);
  assert.match(doc, /MUST NOT accept findings, apply routes, invoke PLAN, or\s+invoke SHIP/u);
  assert.match(doc, /R1 remains mandatory/u);
  assert.doesNotMatch(doc, /\r/u, 'cadence doc is LF-only');
});

test('--check names the cadence doc when it is hand-edited out of sync', () => {
  const projectRoot = seedProjectRoot();
  try {
    const written = runOperatingAssetGenerator({ argv: [], projectRoot });
    assert.equal(written.mode, 'write');
    assert.ok(written.written.includes(CADENCE_DOC), `wrote ${CADENCE_DOC}`);

    // Immediately after generation the drift check is clean.
    assert.deepEqual(
      runOperatingAssetGenerator({ argv: ['--check'], projectRoot }),
      { ok: true, mode: 'check', staleTargets: [] },
    );

    // Hand-edit the generated cadence doc.
    const path = join(projectRoot, CADENCE_DOC);
    writeFileSync(path, `${readFileSync(path, 'utf8')}\nhand edit\n`, 'utf8');

    assert.throws(
      () => runOperatingAssetGenerator({ argv: ['--check'], projectRoot }),
      (error) =>
        error instanceof OperatingAssetGenerationError &&
        error.code === 'E_OPERATING_ASSET_DRIFT' &&
        error.details.staleTargets.includes(CADENCE_DOC),
      'drift check exits non-zero and names the edited cadence doc',
    );
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

// --- FR9: skill-first framing reaches all three runtime guidance assets -------

test('every runtime guidance asset states the skill-first orchestration guarantee', () => {
  const assets = renderOperatingAssets();
  for (const target of RUNTIME_GUIDANCE_TARGETS) {
    const asset = assets[target];
    assert.ok(asset, `${target} is a generated asset`);
    // Collapse wrapping whitespace so phrase assertions do not hinge on line breaks.
    const flat = asset.replace(/\s+/gu, ' ');

    // The skill orchestrates prepare -> record -> finalize invisibly.
    assert.match(flat, /prepare → record → finalize/u, `${target} states the invisible lifecycle`);
    // The user never types an adapter lifecycle subcommand.
    assert.match(
      flat,
      /never required to type an adapter lifecycle subcommand/u,
      `${target} guarantees the user never types an adapter lifecycle command`,
    );
    // R1 still applies to cadence-triggered runs; nothing auto-chains to PLAN/SHIP.
    assert.match(flat, /R1 (?:still )?(?:applies|holds)/u, `${target} keeps R1 for cadence runs`);
    assert.match(flat, /auto-chains? to PLAN or SHIP/u, `${target} forbids auto-chaining PLAN/SHIP`);
    assert.match(
      flat,
      /never accepts findings or applies routes/u,
      `${target} states a scheduled run does not accept findings or apply routes`,
    );

    // No implicit auto-approval: any --yes must remain explicitly bounded.
    if (flat.includes('--yes')) {
      assert.match(flat, /never infer it/u, `${target} keeps --yes explicitly bounded`);
    }
    // No bare instruction to automatically invoke PLAN or SHIP.
    assert.doesNotMatch(
      flat,
      /automatically (?:invoke|run|start|chain) (?:PLAN|SHIP)/iu,
      `${target} never auto-invokes PLAN/SHIP`,
    );
  }
});
