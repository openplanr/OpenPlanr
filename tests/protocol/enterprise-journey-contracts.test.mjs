import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { protocolAssetUrl } from '../../packages/protocol/src/browser-contracts.mjs';
import {
  listProtocolSchemas,
  validateProtocolArtifact,
} from '../../packages/protocol/src/contracts.mjs';
import { ENTERPRISE_JOURNEY_SCHEMAS } from '../../packages/protocol/src/enterprise-journey-contracts.mjs';
import { validateJson } from '../../packages/protocol/src/json-schema.mjs';
import { enterpriseJourneyProof, journeyFixtures } from './fixtures/enterprise-journeys.mjs';

test('company guest, catalog, lifecycle and upload invariants preserve exact identities', () => {
  const { cases } = enterpriseJourneyProof();
  assert.ok(cases.length >= 45);
  for (const result of cases) assert.equal(result.passed, true, result.name);
});
test('closed generated successors match their owning schemas and exact resolver version', () => {
  const listed = listProtocolSchemas().filter((entry) => entry.protocolVersion === '1.19.0');
  assert.equal(listed.length, Object.keys(ENTERPRISE_JOURNEY_SCHEMAS).length);
  for (const [kind, schema] of Object.entries(ENTERPRISE_JOURNEY_SCHEMAS)) {
    assert.deepEqual(
      JSON.parse(readFileSync(protocolAssetUrl(kind, { protocolVersion: '1.19.0' }), 'utf8')),
      schema,
    );
  }
  const { legacy, preparation, receipt } = journeyFixtures();
  assert.deepEqual(
    validateProtocolArtifact('company-resource-upload-prepare', legacy, {
      protocolVersion: '1.17.0',
    }),
    [],
  );
  assert.deepEqual(
    validateProtocolArtifact('company-resource-upload-prepare', preparation, {
      protocolVersion: '1.19.0',
    }),
    [],
  );
  assert.ok(
    validateProtocolArtifact('company-resource-upload-prepare', preparation, {
      protocolVersion: '1.17.0',
    }).length,
  );
  assert.ok(
    validateProtocolArtifact('company-resource-upload-prepare', legacy, {
      protocolVersion: '1.19.0',
    }).length,
  );
  const wrong = structuredClone(receipt);
  wrong.intent = 'publish';
  assert.ok(
    validateJson(wrong, ENTERPRISE_JOURNEY_SCHEMAS['company-resource-upload-receipt']).length,
    'raw schema discriminates commit effect',
  );
  assert.ok(
    validateProtocolArtifact('company-resource-upload-receipt', wrong, {
      protocolVersion: '1.19.0',
    }).length,
  );
});

test('typed page scopes reject catalog and review query interchange', () => {
  execFileSync(
    process.execPath,
    [
      fileURLToPath(new URL('../../node_modules/typescript/bin/tsc', import.meta.url)),
      '--noEmit',
      '--strict',
      '--module',
      'NodeNext',
      '--target',
      'es2022',
      '--types',
      'node',
      fileURLToPath(new URL('./fixtures/enterprise-journey-types.mts', import.meta.url)),
    ],
    { stdio: 'pipe' },
  );
});
