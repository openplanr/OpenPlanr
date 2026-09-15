#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertOperatingMeasurementScheduleV2,
  reduceOperatingMeasurementScheduleV2,
} from 'planr-pipeline';
import { validateProtocolArtifact } from 'planr-pipeline/protocol';

const VERSION = '2.0.0';
const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const fixtureRoot = join(root, 'conformance', 'fixtures', 'live-evidence');
let checks = 0;

function pass(condition, message) {
  assert.ok(condition, message);
  checks += 1;
}

function fixture(name) {
  return JSON.parse(readFileSync(join(fixtureRoot, name), 'utf8'));
}

function refuses(run) {
  try {
    run();
    return false;
  } catch (error) {
    return typeof error?.code === 'string' && error.code.length > 0;
  }
}

const { schedule, enableTransition } = fixture('measurement-schedule-valid.json');
const invalid = fixture('measurement-schedule-invalid.json');

pass(
  validateProtocolArtifact('operating-measurement-schedule', schedule, { protocolVersion: VERSION }).length === 0,
  'the reference schedule satisfies its published contract',
);

pass(
  assertOperatingMeasurementScheduleV2(schedule).state === 'disabled',
  'a newly authored schedule is disabled and enables no measurement on its own',
);

// The refusal probe must accept a valid record, or every refusal below is vacuous.
pass(
  refuses(() => assertOperatingMeasurementScheduleV2(schedule)) === false,
  'the refusal probe accepts the valid reference schedule',
);

for (const [name, candidate] of Object.entries(invalid)) {
  pass(refuses(() => assertOperatingMeasurementScheduleV2(candidate)), `the contract refuses: ${name}`);
}

const enabled = reduceOperatingMeasurementScheduleV2(schedule, enableTransition);
pass(
  enabled.replay === false && enabled.schedule.state === 'enabled' && enabled.schedule.nextDueAt !== null,
  'an explicit owner transition is the only path from disabled to enabled',
);
pass(
  enabled.schedule.generation === schedule.generation + 1
    && enabled.receipt.previousScheduleHash === schedule.scheduleHash,
  'the resulting schedule advances one generation and binds its exact predecessor',
);

const replayed = reduceOperatingMeasurementScheduleV2(enabled.schedule, enableTransition, {
  priorReceipt: enabled.receipt,
});
pass(
  replayed.replay === true && replayed.receipt.receiptHash === enabled.receipt.receiptHash,
  'repeating one transition identity replays its exact receipt instead of running again',
);

pass(
  refuses(() =>
    reduceOperatingMeasurementScheduleV2(
      enabled.schedule,
      { ...enableTransition, nextDueAt: '2026-08-24T14:00:00Z' },
      { priorReceipt: enabled.receipt },
    ),
  ),
  'a divergent transition reusing one receipt identity is refused',
);

pass(
  refuses(() => reduceOperatingMeasurementScheduleV2(enabled.schedule, enableTransition)),
  'replay without the stored prior receipt is refused rather than assumed',
);

pass(
  refuses(() =>
    reduceOperatingMeasurementScheduleV2(schedule, { ...enableTransition, expectedGeneration: 7 }),
  ),
  'a stale expected generation is refused before any state change',
);

process.stdout.write(`${JSON.stringify({
  ok: true,
  protocolVersion: VERSION,
  suite: 'live-evidence',
  refusedShapes: Object.keys(invalid).length,
  checks,
})}\n`);
