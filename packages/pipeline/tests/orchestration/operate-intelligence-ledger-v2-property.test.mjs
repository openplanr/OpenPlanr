import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { validateProtocolArtifact } from '../../lib/protocol/contracts.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';

const fixture = JSON.parse(
  readFileSync(
    new URL(
      '../../conformance/fixtures/operating-runtime-v2/decision-ledger-valid.json',
      import.meta.url,
    ),
    'utf8',
  ),
);

test('property: generated material-fact omissions never cross the challenged decision-ledger contract boundary', () => {
  const before = sha256Jcs(fixture);
  const mutators = [
    (value) => {
      delete value.decisions[0].evidenceRefIds;
    },
    (value) => {
      value.decisions[0].evidenceRefIds = [];
    },
    (value) => {
      delete value.decisions[0].alternativeDispositions;
    },
    (value) => {
      value.decisions[0].alternatives = [];
    },
    (value) => {
      delete value.decisions[0].confidence;
    },
    (value) => {
      delete value.decisions[0].uncertainty;
    },
    (value) => {
      value.decisions[0].uncertainty = '   ';
    },
    (value) => {
      delete value.decisions[0].downside;
    },
    (value) => {
      delete value.decisions[0].reversibility;
    },
    (value) => {
      value.decisions[0].revisitConditions = [];
    },
    (value) => {
      delete value.sourceArtifactId;
    },
  ];
  for (const mutate of mutators) {
    const corrupted = structuredClone(fixture);
    mutate(corrupted);
    assert.ok(
      validateProtocolArtifact('operating-decision-ledger', corrupted, {
        protocolVersion: '2.0.0',
      }).length > 0,
    );
  }
  assert.equal(
    sha256Jcs(fixture),
    before,
    'generated invalid variants never mutate their source vector',
  );
});
