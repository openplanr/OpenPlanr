#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(packageRoot, '..', '..');
const pipelineRoot = resolve(workspaceRoot, 'packages/pipeline');
const registryPath = resolve(pipelineRoot, 'registry/operate-v2-contracts.json');
const custodyPath = resolve(pipelineRoot, 'lib/generated/operate-contract-custody-v1.5.json');
const pipelineGenerator = resolve(pipelineRoot, 'scripts/generate-operate-contracts.mjs');

const canonicalText = (bytes) => bytes.replace(/\r\n/gu, '\n');
const sha256 = (bytes) => createHash('sha256').update(canonicalText(bytes), 'utf8').digest('hex');

function parseMode(argv) {
  if (argv.length !== 1 || !['--write', '--check'].includes(argv[0])) {
    throw new Error('Use exactly one of --write or --check.');
  }
  return argv[0].slice(2);
}

function custodyFor(path) {
  if (path.startsWith('lib/operate/')) return 'canonical-operate-domain-projection';
  if (path.startsWith('lib/protocol/')) return 'canonical-protocol-projection';
  if (path.startsWith('lib/dashboard/')) return 'canonical-protocol-dashboard-runtime';
  if (path === 'docs/protocol/operate-runtime-v2.md') return 'captured-development-overlay';
  if (path === 'scripts/generate-operate-contracts.mjs') return 'protocol-1.5-custody-generator';
  if (path.startsWith('lib/pipeline/') || path.startsWith('scripts/'))
    return 'pipeline-owned-source';
  throw new Error(`A changed legacy verification target has no additive custody class: ${path}`);
}

function sourceFor(path, custody, operateProjection, protocolProjection) {
  if (custody === 'canonical-operate-domain-projection') {
    return operateProjection.get(path) ?? `packages/operate/${path}`;
  }
  if (custody === 'canonical-protocol-projection') {
    return protocolProjection.get(path) ?? `packages/protocol/projections/pipeline/${path}`;
  }
  if (custody === 'canonical-protocol-dashboard-runtime') {
    return `packages/protocol/${path}`;
  }
  return `packages/pipeline/${path}`;
}

function projectionSources(path) {
  if (!existsSync(path)) return new Map();
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  return new Map((manifest.entries ?? []).map(({ target, source }) => [target, source]));
}

function renderCustody() {
  const registryBytes = readFileSync(registryPath, 'utf8');
  const registry = JSON.parse(registryBytes);
  const operateProjection = projectionSources(
    resolve(pipelineRoot, 'lib/generated/domain-projections/operate.json'),
  );
  const protocolProjection = projectionSources(
    resolve(pipelineRoot, 'lib/generated/protocol-projection.json'),
  );
  const overrides = [];
  for (const target of registry.generation.verifiedTargets) {
    const absolute = resolve(pipelineRoot, target.path);
    if (!existsSync(absolute))
      throw new Error(`Operate contract target is missing: ${target.path}`);
    const current = sha256(readFileSync(absolute, 'utf8'));
    if (current === target.sha256) continue;
    const custody = custodyFor(target.path);
    overrides.push({
      path: target.path,
      kind: target.kind,
      legacySha256: target.sha256,
      sha256: current,
      custody,
      source: sourceFor(target.path, custody, operateProjection, protocolProjection),
    });
  }
  overrides.sort((left, right) => left.path.localeCompare(right.path));
  return `${JSON.stringify(
    {
      kind: 'operate-contract-generated-custody',
      schemaVersion: '1.0.0',
      protocolVersion: '1.5.0',
      legacyRegistry: 'registry/operate-v2-contracts.json',
      legacyRegistrySha256: sha256(registryBytes),
      generator: 'packages/operate/scripts/generate-operate-contracts.mjs',
      overrides,
    },
    null,
    2,
  )}\n`;
}

function atomicWrite(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, bytes, 'utf8');
  renameSync(temporary, path);
}

const mode = parseMode(process.argv.slice(2));
const expected = renderCustody();
const current = existsSync(custodyPath) ? readFileSync(custodyPath, 'utf8') : null;
if (mode === 'check' && current !== expected) {
  throw new Error(
    'Operate Protocol 1.5 generated-asset custody is stale. Run the workspace generator.',
  );
}
if (mode === 'write' && current !== expected) atomicWrite(custodyPath, expected);

const generated = spawnSync(process.execPath, [pipelineGenerator, `--${mode}`], {
  cwd: pipelineRoot,
  encoding: 'utf8',
});
if (generated.stdout) process.stdout.write(generated.stdout);
if (generated.stderr) process.stderr.write(generated.stderr);
if (generated.error || generated.signal || generated.status !== 0) {
  throw new Error(
    generated.error?.message ??
      `Pipeline compatibility generator failed (${generated.signal ?? generated.status}).`,
  );
}
const custody = JSON.parse(expected);
process.stdout.write(
  `Operate contract custody ${mode === 'check' ? 'checked' : 'generated'}: ${custody.overrides.length} additive overrides.\n`,
);
