import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  OPERATING_PROTOCOL_VERSION,
  assertProtocolArtifact,
  loadOperatingContractBundle,
  loadProtocolContract,
  reduceOperatingEvents,
} from 'planr-pipeline/protocol';
import { buildOperatingFixture } from '../helpers/operatingFixture.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));

test('stable protocol subpath exposes schemas, registries, validators, and reducer', () => {
  assert.equal(OPERATING_PROTOCOL_VERSION, '1.2.0');
  const bundle = loadOperatingContractBundle();
  assert.equal(bundle.kind, 'operating-contract-bundle');
  assert.equal(bundle.protocolVersion, '1.2.0');
  assert.equal(Object.keys(bundle.schemas).length, 34);
  assert.equal(bundle.roles.length, 6);
  assert.equal(bundle.providers.length, 6);

  const contract = loadProtocolContract('operating-workspace-manifest');
  assert.equal(contract.protocolVersion, '1.2.0');
  assert.ok(contract.schema.properties.controlRepository.required.includes('configuredBranch'));

  contract.schema.title = 'consumer mutation';
  assert.notEqual(
    loadProtocolContract('operating-workspace-manifest').schema.title,
    'consumer mutation',
    'consumers receive defensive schema clones',
  );

  const { events, state } = buildOperatingFixture();
  assert.doesNotThrow(() => assertProtocolArtifact('operating-event', events[0]));
  assert.deepEqual(reduceOperatingEvents(events), state);
});

test('package metadata publishes declarations and stable schema/registry subpaths', () => {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.exports['./protocol'].types, './lib/protocol/index.d.ts');
  assert.equal(packageJson.exports['./protocol'].import, './lib/protocol/loader.mjs');
  assert.equal(packageJson.exports['./schemas/*'], './schemas/*');
  assert.equal(packageJson.exports['./registry/*'], './registry/*');
});

test('schema $ref containment is separator-independent', () => {
  // Regression: the containment check compared a platform-separated relative
  // path against POSIX literals. On Windows `relative()` yields
  // `schemas\v1.2.0\...`, which failed the `schemas/` prefix test (rejecting
  // every valid cross-file $ref) while also hiding `\..\` from the traversal
  // guard. Both directions have to hold on every platform.

  // Every packaged schema resolves its own cross-file references.
  const bundle = loadOperatingContractBundle();
  for (const kind of Object.keys(bundle.schemas)) {
    assert.doesNotThrow(
      () => loadProtocolContract(kind, { protocolVersion: OPERATING_PROTOCOL_VERSION }),
      `${kind} must resolve its schema references`,
    );
  }

  // An artifact whose validation walks a cross-file $ref still validates.
  const { events } = buildOperatingFixture();
  const cycleEvent = events.find((event) => event.type === 'cycle.preparing');
  assert.ok(cycleEvent, 'fixture provides a cycle.preparing event');
  assert.doesNotThrow(() => assertProtocolArtifact('operating-event', cycleEvent));
})
