import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { canonicalizeJson, sha256Hex, sha256Jcs, verifyDocumentDigest } from '../../packages/protocol/src/canonical-json.mjs';
import { listProtocolSchemas, validateProtocolArtifact } from '../../packages/protocol/src/contracts.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const protocol = join(root, 'packages', 'protocol');
const pipeline = join(root, 'packages', 'pipeline');

function walk(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
    const path = join(directory, entry.name);
    const key = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? walk(path, key) : [{ key, path }];
  });
}

test('canonical JSON and dependency-free SHA-256 match known vectors', () => {
  assert.equal(canonicalizeJson({ z: 1, a: ['x', true] }), '{"a":["x",true],"z":1}');
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Jcs({ a: 1 }), 'sha256:015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862');
});

test('all 180 schemas and 12 registries preserve exact source bytes and modes', () => {
  const additiveVersions = new Set(['v1.5.0', 'v1.6.0', 'v1.7.0', 'v1.8.0', 'v1.9.0', 'v1.10.0', 'v1.11.0', 'v1.12.0', 'v1.13.0']);
  const schemas = walk(join(protocol, 'schemas')).filter(({ key }) => !additiveVersions.has(key.split('/')[0]) && key.endsWith('.json'));
  const registries = walk(join(protocol, 'registry')).filter(({ key }) => key.endsWith('.json'));
  assert.equal(schemas.length, 180);
  assert.equal(registries.length, 12);
  for (const { key, path } of schemas) {
    const source = join(pipeline, 'schemas', key);
    assert.deepEqual(readFileSync(path), readFileSync(source), `schema bytes: ${key}`);
    assert.equal(statSync(path).mode & 0o777, statSync(source).mode & 0o777, `schema mode: ${key}`);
  }
  for (const { key, path } of registries) {
    const source = join(pipeline, 'registry', key);
    assert.deepEqual(readFileSync(path), readFileSync(source), `registry bytes: ${key}`);
    assert.equal(statSync(path).mode & 0o777, statSync(source).mode & 0o777, `registry mode: ${key}`);
  }
});

test('Protocol 1.5 owns thirteen additive schemas with exact identities', () => {
  const files = walk(join(protocol, 'schemas', 'v1.5.0')).filter(({ key }) => key.endsWith('.json'));
  assert.equal(files.length, 13);
  for (const { key, path } of files) {
    const schema = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(schema.$id, `https://openplanr.dev/schemas/v1.5.0/${key}`);
    assert.equal(schema['x-openplanr-contract'].version, '1.5.0');
  }
  const table = listProtocolSchemas().filter(({ protocolVersion }) => protocolVersion === '1.5.0');
  assert.equal(table.length, 12, 'definitions-only common schema is not a document contract');
});

test('all canonical registries satisfy schemas and their RFC 8785 digest', () => {
  const pairs = [
    ['roles.json', 'role-registry'], ['task-kinds.json', 'task-kind-registry'], ['rules.json', 'rule-catalog'],
    ['commands.json', 'command-catalog'], ['skills.json', 'skill-catalog'], ['outputs.json', 'output-catalog'],
    ['output-paths.json', 'output-path-catalog'],
  ];
  for (const [file, kind] of pairs) {
    const value = JSON.parse(readFileSync(join(protocol, 'registries', file), 'utf8'));
    assert.equal(verifyDocumentDigest(value), true, file);
    assert.deepEqual(validateProtocolArtifact(kind, value, { protocolVersion: '1.5.0' }), [], file);
    const invalid = { ...value, unexpected: true };
    assert.ok(validateProtocolArtifact(kind, invalid, { protocolVersion: '1.5.0' })
      .some(({ rule }) => rule === 'additionalProperties'));
  }
});

test('generation check is deterministic and package exports are explicit', () => {
  const output = execFileSync(process.execPath, ['packages/protocol/scripts/generate-protocol-assets.mjs', '--check'], {
    cwd: root, encoding: 'utf8',
  });
  assert.match(output, /Checked \d+ Protocol assets; preserved 180 schemas and 12 registries/);
  const manifest = JSON.parse(readFileSync(join(protocol, 'package.json'), 'utf8'));
  for (const key of ['.', './errors', './canonical-json', './json-schema', './contracts', './browser-contracts', './diagram-contracts', './diagram-authoring-contracts', './design-contracts', './design-handoff-contracts', './workspace-contracts', './enterprise-contracts', './review-experience-contracts', './planning-contracts', './registries', './task-contracts', './schemas/*', './registry/*', './registries/*']) {
    assert.ok(manifest.exports[key], `missing export ${key}`);
  }
  for (const path of ['src/index.mjs', 'src/canonical-json.mjs', 'src/json-schema.mjs', 'src/registries.mjs', 'src/browser-contracts.mjs']) {
    assert.doesNotMatch(readFileSync(join(protocol, path), 'utf8'), /from ['"]node:/, `${path} must remain browser-safe`);
  }
});

test('the Protocol root exposes v1.6 contracts while the Node validator subpath stays narrow', async () => {
  const rootModule = await import('../../packages/protocol/src/index.mjs');
  const browserModule = await import('../../packages/protocol/src/browser-contracts.mjs');
  const nodeContracts = await import('../../packages/protocol/src/contracts.mjs');
  assert.strictEqual(rootModule.PROTOCOL_V16_CONTRACTS, browserModule.PROTOCOL_V16_CONTRACTS);
  assert.equal(Object.keys(rootModule.PROTOCOL_V16_CONTRACTS).length, 18);
  const skillSourceUrl = rootModule.protocolAssetUrl('skill-source', { protocolVersion: '1.6.0' });
  assert.equal(skillSourceUrl.protocol, 'file:');
  assert.equal(JSON.parse(readFileSync(skillSourceUrl, 'utf8'))['x-openplanr-contract'].version, '1.6.0');
  const handoffUrl = rootModule.protocolAssetUrl('design-handoff-readiness', { protocolVersion: '1.11.0' });
  assert.equal(JSON.parse(readFileSync(handoffUrl, 'utf8'))['x-openplanr-contract'].version, '1.11.0');
  assert.strictEqual(rootModule.PROTOCOL_V113_CONTRACTS, browserModule.PROTOCOL_V113_CONTRACTS);
  assert.equal(Object.keys(rootModule.PROTOCOL_V113_CONTRACTS).length, 10);
  assert.throws(() => rootModule.protocolAssetUrl('constructor', { protocolVersion: '1.13.0' }), RangeError);
  assert.throws(() => rootModule.protocolAssetUrl('diagram-document', { protocolVersion: 'constructor' }), RangeError);
  const authoringUrl = rootModule.protocolAssetUrl('diagram-authoring-bundle', { protocolVersion: '1.13.0' });
  assert.equal(JSON.parse(readFileSync(authoringUrl, 'utf8'))['x-openplanr-contract'].version, '1.13.0');
  assert.equal(Object.hasOwn(nodeContracts, 'PROTOCOL_V16_CONTRACTS'), false);
  assert.doesNotMatch(readFileSync(join(protocol, 'src', 'contracts.d.mts'), 'utf8'), /browser-contracts/u);

  execFileSync(process.execPath, [
    join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
    '--noEmit',
    '--strict',
    '--skipLibCheck',
    '--target', 'ES2022',
    '--module', 'NodeNext',
    '--moduleResolution', 'NodeNext',
    join(root, 'tests', 'protocol', 'fixtures', 'root-export-contract.mts'),
  ], { cwd: root, encoding: 'utf8' });
});

test('every runtime contract export has a consumable TypeScript declaration', async () => {
  const runtime = await import('../../packages/protocol/src/contracts.mjs');
  const exportNames = Object.keys(runtime).sort();
  const declarations = readFileSync(join(protocol, 'src', 'contracts.d.mts'), 'utf8');
  for (const name of exportNames) {
    assert.match(
      declarations,
      new RegExp(`export declare (?:const|function) ${name}\\b`, 'u'),
      `missing declaration for ${name}`,
    );
  }

  const temporary = mkdtempSync(join(tmpdir(), 'openplanr-contract-types-'));
  try {
    const fixture = join(temporary, 'consumer.mts');
    const modulePath = join(protocol, 'src', 'contracts.mjs').replaceAll('\\\\', '/');
    writeFileSync(
      fixture,
      `import { ${exportNames.join(', ')} } from ${JSON.stringify(modulePath)};\n` +
        `export const imported = [${exportNames.join(', ')}] as const;\n`,
    );
    execFileSync(
      process.execPath,
      [
        join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
        '--noEmit',
        '--strict',
        '--skipLibCheck',
        '--target',
        'ES2022',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        fixture,
      ],
      { cwd: root, encoding: 'utf8' },
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
