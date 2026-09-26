import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  listProtocolSchemas,
  validateProtocolArtifact,
} from '../../packages/protocol/src/contracts.mjs';
import { verifyDocumentDigest } from '../../packages/protocol/src/canonical-json.mjs';
import {
  DIAGRAM_V16_REGISTRIES,
  PROTOCOL_V17_REGISTRIES,
} from '../../packages/protocol/src/skill-source-contracts.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const protocol = join(root, 'packages', 'protocol');
const fixtures = join(import.meta.dirname, 'fixtures', 'skill-source');
const load = (name) => JSON.parse(readFileSync(join(fixtures, name), 'utf8'));

const V16 = '1.6.0';
const SCHEMA_URL = 'https://json-schema.org/draft/2020-12/schema';

test('Protocol 1.6 owns nineteen closed additive schemas with exact identities', () => {
  const files = readdirSync(join(protocol, 'schemas', 'v1.6.0'))
    .filter((name) => name.endsWith('.json'))
    .sort();
  assert.equal(files.length, 19);
  for (const name of files) {
    const schema = JSON.parse(readFileSync(join(protocol, 'schemas', 'v1.6.0', name), 'utf8'));
    assert.equal(schema.$schema, SCHEMA_URL);
    assert.equal(schema.$id, `https://openplanr.dev/schemas/v1.6.0/${name}`);
    assert.equal(schema['x-openplanr-contract'].version, V16);
    if (name !== 'common.schema.json') {
      assert.equal(schema.additionalProperties, false, `${name} must be a closed object`);
    }
  }
  const documents = listProtocolSchemas().filter(({ protocolVersion }) => protocolVersion === V16);
  assert.equal(documents.length, 18, 'definitions-only common schema is not a document contract');
  const completion = JSON.parse(
    readFileSync(
      join(protocol, 'schemas', 'v1.6.0', 'skill-completion-receipt.schema.json'),
      'utf8',
    ),
  );
  assert.match(completion.description, /Optional reporting-only summary/u);
  assert.match(completion.description, /never a Plan, Review, Ship/u);
});

test('generated v1.6 and v1.7 registries validate against their contracts and RFC 8785 digests', () => {
  const descriptors = { ...DIAGRAM_V16_REGISTRIES, ...PROTOCOL_V17_REGISTRIES };
  const generated = readdirSync(join(protocol, 'registries'))
    .filter((file) => file in descriptors)
    .sort();
  assert.deepEqual(generated, Object.keys(descriptors).sort());
  for (const [file, descriptor] of Object.entries(descriptors)) {
    const value = JSON.parse(readFileSync(join(protocol, 'registries', file), 'utf8'));
    assert.equal(value.protocolVersion, descriptor.protocolVersion, file);
    assert.equal(value.kind, descriptor.kind, file);
    assert.equal(value.schemaVersion, descriptor.schemaVersion, file);
    assert.equal(value.documentVersion, descriptor.documentVersion, file);
    assert.equal(verifyDocumentDigest(value), true, file);
    assert.deepEqual(
      validateProtocolArtifact(descriptor.kind, value, {
        protocolVersion: descriptor.protocolVersion,
      }),
      [],
      file,
    );
  }
});

test('projection and ecosystem generators share canonical versioned registry descriptors', () => {
  const consumers = [
    'scripts/protocol/project-protocol.mjs',
    'scripts/marketplace/generate-ecosystem.mjs',
  ];
  for (const relativePath of consumers) {
    const source = readFileSync(join(root, relativePath), 'utf8');
    assert.match(source, /DIAGRAM_V16_REGISTRIES/u, relativePath);
    assert.match(source, /PROTOCOL_V17_REGISTRIES/u, relativePath);
    for (const file of Object.keys({ ...DIAGRAM_V16_REGISTRIES, ...PROTOCOL_V17_REGISTRIES })) {
      assert.doesNotMatch(
        source,
        new RegExp(`['\"]${file.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}['\"]`, 'u'),
        `${relativePath} duplicates ${file}`,
      );
    }
  }
});

test('valid composed, markdown, module-registry, and consent contracts pass validation', () => {
  assert.deepEqual(
    validateProtocolArtifact('skill-source', load('skill-source-composed.json'), {
      protocolVersion: V16,
    }),
    [],
  );
  assert.deepEqual(
    validateProtocolArtifact('skill-source', load('skill-source-markdown.json'), {
      protocolVersion: V16,
    }),
    [],
  );
  assert.deepEqual(
    validateProtocolArtifact('skill-module-registry', load('skill-module-registry.json'), {
      protocolVersion: V16,
    }),
    [],
  );
  assert.deepEqual(
    validateProtocolArtifact('skill-consent-record', load('skill-consent-record.json'), {
      protocolVersion: V16,
    }),
    [],
  );
});

test('the composed-v1 and markdown-v1 modes are mutually exclusive', () => {
  const composed = load('skill-source-composed.json');
  const crossed = {
    ...composed,
    markdown: { path: 'skills/x/SKILL.md', digest: composed.template.digest },
  };
  assert.ok(
    validateProtocolArtifact('skill-source', crossed, { protocolVersion: V16 }).length > 0,
    'a composed-v1 source may not also carry a markdown snapshot',
  );
  const markdown = load('skill-source-markdown.json');
  const wrongMode = { ...markdown, sourceFormat: 'composed-v1' };
  assert.ok(
    validateProtocolArtifact('skill-source', wrongMode, { protocolVersion: V16 }).length > 0,
    'a markdown snapshot may not declare the composed-v1 mode',
  );
});

test('source-mode selectors require concrete sources and composed skills require a host', () => {
  const markdown = load('skill-source-markdown.json');
  assert.ok(
    validateProtocolArtifact(
      'skill-source',
      { ...markdown, markdown: null },
      { protocolVersion: V16 },
    ).length > 0,
    'markdown-v1 may not select its source branch with a null source',
  );
  assert.deepEqual(
    validateProtocolArtifact(
      'skill-source',
      { ...markdown, hostProfiles: [] },
      { protocolVersion: V16 },
    ),
    [],
    'markdown-v1 retains its host-neutral compatibility shape',
  );

  const composed = load('skill-source-composed.json');
  assert.ok(
    validateProtocolArtifact(
      'skill-source',
      { ...composed, template: null },
      { protocolVersion: V16 },
    ).length > 0,
    'composed-v1 may not select its source branch with a null template',
  );
  assert.ok(
    validateProtocolArtifact(
      'skill-source',
      { ...composed, hostProfiles: [] },
      { protocolVersion: V16 },
    ).length > 0,
    'composed-v1 requires at least one exact host-profile selection',
  );
});

test('closed objects reject an unexpected property', () => {
  const source = { ...load('skill-source-composed.json'), unexpected: true };
  assert.ok(
    validateProtocolArtifact('skill-source', source, { protocolVersion: V16 }).some(
      ({ rule }) => rule === 'additionalProperties',
    ),
  );
  const registry = load('skill-module-registry.json');
  const withExtra = { ...registry, modules: [{ ...registry.modules[0], unexpected: true }] };
  assert.ok(
    validateProtocolArtifact('skill-module-registry', withExtra, { protocolVersion: V16 }).some(
      ({ rule }) => rule === 'additionalProperties',
    ),
  );
});

test('an unknown capability output class outside the ceiling domain is rejected', () => {
  const source = load('skill-source-composed.json');
  const widened = {
    ...source,
    authorityCeiling: { ...source.authorityCeiling, allowedOutputClasses: ['A', 'X'] },
  };
  assert.ok(validateProtocolArtifact('skill-source', widened, { protocolVersion: V16 }).length > 0);

  const badTool = {
    ...source,
    authorityCeiling: { ...source.authorityCeiling, allowedTools: ['InventedTool'] },
  };
  assert.ok(
    validateProtocolArtifact('skill-source', badTool, { protocolVersion: V16 }).length > 0,
    'tool names must match the closed raw-host vocabulary',
  );
});

test('the authority ceiling encodes the component-wise monotone lattice domains', () => {
  const source = load('skill-source-composed.json');
  // Each lattice component only accepts its declared narrowing domain.
  for (const value of ['declared-paths', 'read-only', 'none']) {
    const ok = {
      ...source,
      authorityCeiling: { ...source.authorityCeiling, repositoryAccess: value },
    };
    assert.deepEqual(
      validateProtocolArtifact('skill-source', ok, { protocolVersion: V16 }),
      [],
      `repositoryAccess ${value}`,
    );
  }
  const badRepo = {
    ...source,
    authorityCeiling: { ...source.authorityCeiling, repositoryAccess: 'write' },
  };
  assert.ok(validateProtocolArtifact('skill-source', badRepo, { protocolVersion: V16 }).length > 0);
  // externalDataAccess never permits a repository-style write level.
  const badExternal = {
    ...source,
    authorityCeiling: { ...source.authorityCeiling, externalDataAccess: 'declared-paths' },
  };
  assert.ok(
    validateProtocolArtifact('skill-source', badExternal, { protocolVersion: V16 }).length > 0,
  );
  // A ceiling missing a required component is rejected as an incomplete shape.
  const { forbiddenEffects, ...incomplete } = source.authorityCeiling;
  const missingComponent = { ...source, authorityCeiling: incomplete };
  assert.ok(
    validateProtocolArtifact('skill-source', missingComponent, { protocolVersion: V16 }).length > 0,
  );
});

test('a learning record may not imply consent without an explicit consent reference', () => {
  const base = {
    kind: 'skill-learning-record',
    schemaVersion: '1.0.0',
    protocolVersion: V16,
    documentVersion: '1.0.0',
    digestAlgorithm: 'sha256',
    canonicalization: 'rfc8785',
    documentDigest: `sha256:${'a'.repeat(64)}`,
    learningId: 'learn-1',
    skillId: 'planr-plan',
    observedAt: '2026-08-30T00:00:00Z',
    category: 'context',
    note: 'Observed a reusable context step.',
    consentGranted: false,
    consentRef: null,
  };
  assert.deepEqual(
    validateProtocolArtifact('skill-learning-record', base, { protocolVersion: V16 }),
    [],
  );
  const impliedConsent = { ...base, consentGranted: true, consentRef: null };
  assert.ok(
    validateProtocolArtifact('skill-learning-record', impliedConsent, { protocolVersion: V16 })
      .length > 0,
    'granted consent requires an explicit consent reference',
  );
});
