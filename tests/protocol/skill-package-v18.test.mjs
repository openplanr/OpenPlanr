import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { protocolAssetUrl } from '../../packages/protocol/src/browser-contracts.mjs';
import {
  resolveProtocolSchema,
  validateProtocolArtifact,
} from '../../packages/protocol/src/contracts.mjs';

const packageDocument = {
  kind: 'openplanr-skill-package',
  schemaVersion: '1.0.0',
  protocolVersion: '1.8.0',
  skillId: 'planr-ship',
  skillVersion: '1.2.0',
  entrypoint: 'SKILL.md',
  hosts: ['claude-code', 'codex', 'chatgpt', 'cursor'],
  execution: 'host-agent',
  resources: [
    {
      path: 'references/output-contract.md',
      kind: 'reference',
      hosts: ['claude-code', 'codex', 'chatgpt', 'cursor'],
      executable: false,
    },
    {
      path: 'scripts/discover-verification.mjs',
      kind: 'script',
      hosts: ['claude-code', 'codex'],
      executable: true,
    },
  ],
};

test('Protocol 1.8 validates a closed standard skill package', () => {
  assert.deepEqual(validateProtocolArtifact('skill-package', packageDocument), []);
  assert.match(
    resolveProtocolSchema('skill-package', { protocolVersion: '1.8.0' }).path,
    /schemas\/v1\.8\.0\/skill-package\.schema\.json$/u,
  );
  assert.match(
    protocolAssetUrl('skill-package', { protocolVersion: '1.8.0' }).pathname,
    /skill-package\.schema\.json$/u,
  );
});

test('Protocol 1.8 rejects unsafe resources and executable non-scripts', () => {
  const unsafe = structuredClone(packageDocument);
  unsafe.resources[0].path = '../outside.md';
  assert.ok(validateProtocolArtifact('skill-package', unsafe).length > 0);

  const executableReference = structuredClone(packageDocument);
  executableReference.resources[0].executable = true;
  assert.ok(validateProtocolArtifact('skill-package', executableReference).length > 0);
});

test('Protocol 1.8 validates the generated semantic/utility command boundary', () => {
  const catalog = JSON.parse(readFileSync(
    new URL('../../docs/generated/utility-command-catalog.json', import.meta.url),
    'utf8',
  ));
  assert.deepEqual(validateProtocolArtifact('utility-command-catalog', catalog), []);
  assert.ok(catalog.retired.some(({ path }) => path === 'plan'));
  assert.ok(catalog.retired.some(({ path }) => path === 'spec decompose'));
  assert.ok(catalog.active.every(({ classification }) => classification === 'deterministic-preserved'));
});
