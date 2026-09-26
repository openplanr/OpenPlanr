#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const command = (script, writeArguments, checkArguments = [...writeArguments, '--check']) =>
  Object.freeze({
    write: Object.freeze({ script, arguments: Object.freeze(writeArguments) }),
    check: Object.freeze({ script, arguments: Object.freeze(checkArguments) }),
  });

export const GENERATOR_STEPS = Object.freeze([
  Object.freeze({
    id: 'skill-role-host-adapters',
    required: true,
    candidates: Object.freeze([
      command('scripts/skills/generate-v18.mjs', ['--write'], ['--check']),
    ]),
  }),
  Object.freeze({
    id: 'protocol-catalogs',
    required: true,
    candidates: Object.freeze([
      command('packages/protocol/scripts/generate-protocol-assets.mjs', [], ['--check']),
    ]),
  }),
  Object.freeze({
    id: 'protocol-public-projection',
    required: true,
    candidates: Object.freeze([
      command(
        'scripts/protocol/project-protocol.mjs',
        ['--write', '--target', 'packages/pipeline'],
        ['--check', '--target', 'packages/pipeline'],
      ),
    ]),
  }),
  Object.freeze({
    id: 'dashboard-contracts',
    required: true,
    candidates: Object.freeze([
      command(
        'packages/protocol/scripts/generate-dashboard-surface-schema-data.mjs',
        [],
        ['--check'],
      ),
      command(
        'packages/pipeline/scripts/generate-dashboard-surface-schema-data.mjs',
        [],
        ['--check'],
      ),
    ]),
  }),
  Object.freeze({
    id: 'artifact-shell',
    required: true,
    candidates: Object.freeze([
      command('packages/artifact/scripts/generate-artifact-shell.mjs', [], ['--check']),
    ]),
  }),
  Object.freeze({
    id: 'diagram-assets',
    required: true,
    candidates: Object.freeze([
      command('packages/artifact/scripts/generate-diagram-assets.mjs', [], ['--check']),
    ]),
  }),
  Object.freeze({
    id: 'design-studio',
    required: true,
    candidates: Object.freeze([
      command('packages/design/scripts/generate-design-studio.mjs', [], ['--check']),
    ]),
  }),
  Object.freeze({
    id: 'operate-artifact-design-public-projections',
    required: true,
    candidates: Object.freeze([
      command(
        'scripts/domains/project-domains.mjs',
        ['--write', '--target', 'packages/pipeline'],
        ['--check', '--target', 'packages/pipeline'],
      ),
    ]),
  }),
  Object.freeze({
    id: 'operate-contracts-and-custody',
    required: true,
    candidates: Object.freeze([
      command('packages/operate/scripts/generate-operate-contracts.mjs', ['--write'], ['--check']),
    ]),
  }),
  Object.freeze({
    id: 'landing-workflow-custody',
    required: true,
    candidates: Object.freeze([
      command(
        'packages/pipeline/scripts/generate-landing-workflow-assets.mjs',
        ['--write'],
        ['--check'],
      ),
    ]),
  }),
  Object.freeze({
    id: 'dashboard-package-assets',
    required: true,
    activeWhen: Object.freeze(['apps/dashboard/package.json']),
    candidates: Object.freeze([
      Object.freeze({
        write: Object.freeze({
          script: 'scripts/dashboard/build-dashboard-assets.mjs',
          arguments: Object.freeze([]),
        }),
        check: Object.freeze({
          script: 'scripts/dashboard/check-dashboard-assets.mjs',
          arguments: Object.freeze(['--check']),
        }),
      }),
    ]),
  }),
  Object.freeze({
    id: 'ecosystem-marketplace',
    required: true,
    candidates: Object.freeze([
      command('scripts/marketplace/generate-ecosystem.mjs', ['--write'], ['--check']),
    ]),
  }),
]);

function availableScript(script) {
  const path = resolve(repoRoot, script);
  return existsSync(path) && !lstatSync(path).isSymbolicLink() && lstatSync(path).isFile();
}

export function resolveGeneratorPlan(mode, { exists = existsSync } = {}) {
  if (!['write', 'check'].includes(mode)) throw new Error(`Unsupported generation mode: ${mode}`);
  return GENERATOR_STEPS.map((step) => {
    const active =
      !step.activeWhen || step.activeWhen.some((path) => exists(resolve(repoRoot, path)));
    if (!active)
      return Object.freeze({
        id: step.id,
        status: 'deferred',
        reason: `inactive until one of: ${step.activeWhen.join(', ')}`,
      });
    const selected = step.candidates
      .map((candidate) => candidate[mode])
      .find(({ script }) => availableScript(script));
    if (!selected) {
      const candidates = step.candidates.map((candidate) => candidate[mode].script);
      if (step.required)
        throw new Error(
          `Required generator ${step.id} is missing. Expected one of: ${candidates.join(', ')}`,
        );
      return Object.freeze({
        id: step.id,
        status: 'deferred',
        reason: `no generator landed: ${candidates.join(', ')}`,
      });
    }
    return Object.freeze({
      id: step.id,
      status: 'run',
      script: selected.script,
      arguments: selected.arguments,
    });
  });
}

function indent(bytes) {
  return bytes
    .trimEnd()
    .split('\n')
    .filter(Boolean)
    .map((line) => `    ${line}`)
    .join('\n');
}

export function runGenerationGraph(mode) {
  const plan = resolveGeneratorPlan(mode);
  let ran = 0;
  let deferred = 0;
  for (let index = 0; index < plan.length; index += 1) {
    const step = plan[index];
    const prefix = `[${String(index + 1).padStart(2, '0')}/${plan.length}]`;
    if (step.status === 'deferred') {
      deferred += 1;
      process.stdout.write(`${prefix} ${step.id}: deferred (${step.reason})\n`);
      continue;
    }
    process.stdout.write(`${prefix} ${step.id}: ${mode} via ${step.script}\n`);
    const result = spawnSync(process.execPath, [step.script, ...step.arguments], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, OPENPLANR_GENERATION_MODE: mode, NO_COLOR: '1' },
    });
    const stdout = indent(result.stdout ?? '');
    const stderr = indent(result.stderr ?? '');
    if (stdout) process.stdout.write(`${stdout}\n`);
    if (result.error || result.signal || result.status !== 0) {
      if (stderr) process.stderr.write(`${stderr}\n`);
      const reason =
        result.error?.message ??
        (result.signal ? `signal ${result.signal}` : `exit ${result.status}`);
      throw new Error(
        `Generator step ${step.id} failed (${reason}): ${process.execPath} ${[step.script, ...step.arguments].join(' ')}`,
      );
    }
    if (stderr) process.stderr.write(`${stderr}\n`);
    ran += 1;
  }
  process.stdout.write(`Generation graph ${mode} complete: ${ran} ran, ${deferred} deferred.\n`);
  return Object.freeze({ mode, ran, deferred });
}

function parseMode(argv) {
  if (argv.length === 0) return 'write';
  if (argv.length === 1 && ['--write', '--check'].includes(argv[0])) return argv[0].slice(2);
  process.stderr.write('Usage: node scripts/generate-all.mjs [--write|--check]\n');
  process.exitCode = 2;
  return null;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const mode = parseMode(process.argv.slice(2));
  if (mode) {
    try {
      runGenerationGraph(mode);
    } catch (error) {
      process.stderr.write(`E_GENERATION_GRAPH: ${error.message}\n`);
      process.exitCode = 1;
    }
  }
}
