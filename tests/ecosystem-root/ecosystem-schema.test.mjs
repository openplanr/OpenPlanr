import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateJson } from '../../packages/protocol/src/json-schema.mjs';
import { SEMVER_PATTERN } from '../../packages/protocol/src/semver.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const json = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const schema = json('scripts/marketplace/openplanr-ecosystem.schema.json');
const emitted = json('ecosystem.json');

test('the emitted ecosystem.json satisfies its schema', () => {
  assert.deepEqual(validateJson(emitted, schema), []);
});

test('the schema uses the canonical SemVer grammar', () => {
  assert.equal(schema.$defs.semver.pattern, SEMVER_PATTERN);
});

test('every object the schema declares is closed and requires all of its properties', () => {
  const open = [];
  const visit = (node, path) => {
    if (node === null || typeof node !== 'object') return;
    // A `$ref` sibling only narrows properties of the closed definition it references.
    if ((node.type === 'object' || 'properties' in node) && !('$ref' in node)) {
      const declared = Object.keys(node.properties ?? {}).sort();
      const required = [...(node.required ?? [])].sort();
      if (
        node.additionalProperties !== false ||
        JSON.stringify(required) !== JSON.stringify(declared)
      )
        open.push(path);
    }
    for (const [key, child] of Object.entries(node)) visit(child, `${path}/${key}`);
  };
  visit(schema, '#');
  assert.deepEqual(open, []);
});

const rejections = [
  {
    rule: 'additionalProperties',
    path: '$',
    reason: 'an undeclared top-level field',
    mutate: (document) => {
      document.generatedAt = '2026-09-26T00:00:00Z';
    },
  },
  {
    rule: 'additionalProperties',
    path: '$.components.dashboard',
    reason: 'an undeclared component field',
    mutate: (document) => {
      document.components.dashboard.state = 'deferred-local-extraction';
    },
  },
  {
    rule: 'required',
    path: '$',
    reason: 'a missing top-level section',
    mutate: (document) => {
      delete document.generatedSurfaces;
    },
  },
  {
    rule: 'required',
    path: '$.components',
    reason: 'a missing component',
    mutate: (document) => {
      delete document.components.skillRuntime;
    },
  },
  {
    rule: 'const',
    path: '$.kind',
    reason: 'another document kind',
    mutate: (document) => {
      document.kind = 'openplanr-ecosystem-manifest';
    },
  },
  {
    rule: 'const',
    path: '$.components.pipeline.path',
    reason: 'a moved pipeline component',
    mutate: (document) => {
      document.components.pipeline.path = 'packages/planr-pipeline';
    },
  },
  {
    rule: 'enum',
    path: '$.adapters.hosts[0].capabilityLevel',
    reason: 'an unknown adapter capability level',
    mutate: (document) => {
      document.adapters.hosts[0].capabilityLevel = 'full';
    },
  },
  {
    rule: 'type',
    path: '$.catalogs.skills.count',
    reason: 'a count serialized as a string',
    mutate: (document) => {
      document.catalogs.skills.count = String(document.catalogs.skills.count);
    },
  },
  {
    rule: 'type',
    path: '$.components.dashboard.version',
    reason: 'a component without a version',
    mutate: (document) => {
      document.components.dashboard.version = null;
    },
  },
  {
    rule: 'pattern',
    path: '$.workspace.manifestDigest',
    reason: 'a digest that is not SHA-256',
    mutate: (document) => {
      document.workspace.manifestDigest = 'sha1:da39a3ee5e6b4b0d3255bfef95601890afd80709';
    },
  },
  {
    rule: 'pattern',
    path: '$.components.cli.version',
    reason: 'a version that is not SemVer',
    mutate: (document) => {
      document.components.cli.version = '2.2639';
    },
  },
  {
    rule: 'pattern',
    path: '$.catalogs.commands.path',
    reason: 'a path that leaves the repository',
    mutate: (document) => {
      document.catalogs.commands.path = '../marketplace/commands.json';
    },
  },
  {
    rule: 'pattern',
    path: '$.protocol.supportedReaders[0]',
    reason: 'a reader range that is not major.minor.x',
    mutate: (document) => {
      document.protocol.supportedReaders[0] = '1.0.*';
    },
  },
  {
    rule: 'minLength',
    path: '$.catalogs.commands.negativeContracts[0].forbiddenArgvPrefix[0]',
    reason: 'an empty forbidden argv token',
    mutate: (document) => {
      document.catalogs.commands.negativeContracts[0].forbiddenArgvPrefix[0] = '';
    },
  },
  {
    rule: 'minimum',
    path: '$.catalogs.roles.count',
    reason: 'a negative count',
    mutate: (document) => {
      document.catalogs.roles.count = -1;
    },
  },
  {
    rule: 'minItems',
    path: '$.adapters.hosts',
    reason: 'no adapter hosts',
    mutate: (document) => {
      document.adapters.hosts = [];
    },
  },
  {
    rule: 'maxItems',
    path: '$.catalogs.skills.aliases',
    reason: 'a compatibility alias',
    mutate: (document) => {
      document.catalogs.skills.aliases = ['planr-docs'];
    },
  },
  {
    rule: 'uniqueItems',
    path: '$.catalogs.skills.ids',
    reason: 'a duplicated skill id',
    mutate: (document) => {
      document.catalogs.skills.ids.push(document.catalogs.skills.ids[0]);
    },
  },
];

for (const { rule, path, reason, mutate } of rejections) {
  test(`the schema rejects ${reason} (${rule} at ${path})`, () => {
    const document = structuredClone(emitted);
    mutate(document);
    const errors = validateJson(document, schema);
    assert.ok(
      errors.some((error) => error.rule === rule && error.path === path),
      `expected ${rule} at ${path}, got ${JSON.stringify(errors)}`,
    );
  });
}
