#!/usr/bin/env node

import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rawArgs = process.argv.slice(2);
const STRICT_KIND = 'openplanr-packed-workspace-strict-verification';
const STRICT_SCHEMA_VERSION = '1.0.0';

function optionValue(name) {
  const inline = rawArgs.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = rawArgs.indexOf(name);
  if (index === -1) return null;
  const value = rawArgs[index + 1];
  return value && !value.startsWith('--') ? value : '';
}

function unsupportedArgument() {
  return rawArgs.find(
    (argument, index) =>
      argument !== '--proof' &&
      !argument.startsWith('--proof=') &&
      rawArgs[index - 1] !== '--proof',
  );
}

function run(script, args = []) {
  return spawnSync(process.execPath, [join(repositoryRoot, script), ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    maxBuffer: 64 * 1024 * 1024,
    timeout: 30 * 60 * 1000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function parseJson(bytes) {
  try {
    return JSON.parse(bytes);
  } catch {
    return null;
  }
}

function safeCleanup(directory) {
  if (!directory) return;
  const selected = realpathSync(directory);
  const temporaryRoot = realpathSync(tmpdir());
  if (
    dirname(selected) !== temporaryRoot ||
    !selected.startsWith(join(temporaryRoot, 'openplanr-packed-strict-'))
  ) {
    throw new Error('Refused to clean an unsafe strict-proof workspace.');
  }
  rmSync(selected, { recursive: true, force: true });
}

function reportFailure(code, message, detail = undefined) {
  process.stdout.write(
    `${JSON.stringify(
      {
        kind: STRICT_KIND,
        schemaVersion: STRICT_SCHEMA_VERSION,
        ok: false,
        error: { code, message, ...(detail === undefined ? {} : { detail }) },
      },
      null,
      2,
    )}\n`,
  );
  process.exitCode = 1;
}

const unknown = unsupportedArgument();
const suppliedProof = optionValue('--proof');
if (unknown) {
  reportFailure('E_PACKED_STRICT_OPTION_UNKNOWN', `Unknown option: ${unknown}`);
} else if (suppliedProof === '') {
  reportFailure('E_PACKED_STRICT_PROOF_REQUIRED', '`--proof` requires a JSON proof path.');
} else {
  let temporaryWorkspace;
  try {
    let proofPath;
    let proof;
    if (suppliedProof === null) {
      temporaryWorkspace = mkdtempSync(join(tmpdir(), 'openplanr-packed-strict-'));
      const produced = run('scripts/verify-packed-workspace.mjs');
      proof = parseJson(produced.stdout);
      if (produced.error || produced.status !== 0 || proof?.ok !== true) {
        reportFailure(
          'E_PACKED_STRICT_PRODUCER_FAILED',
          'Packed-workspace proof generation failed.',
          proof ??
            (produced.stderr || produced.error?.message || `exit ${String(produced.status)}`),
        );
      } else {
        proofPath = join(temporaryWorkspace, 'packed-workspace-proof.json');
        writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
      }
    } else {
      proofPath = resolve(suppliedProof);
      proof = parseJson(readFileSync(proofPath, 'utf8'));
    }

    if (process.exitCode !== 1) {
      const consumed = run('packages/pipeline/scripts/ecosystem-conformance.mjs', [
        '--strict',
        '--json',
        '--proof',
        proofPath,
      ]);
      const conformance = parseJson(consumed.stdout);
      if (consumed.error || consumed.status !== 0 || conformance?.ok !== true) {
        reportFailure(
          'E_PACKED_STRICT_CONSUMER_FAILED',
          'Strict ecosystem conformance rejected the packed-workspace proof.',
          conformance ??
            (consumed.stderr || consumed.error?.message || `exit ${String(consumed.status)}`),
        );
      } else {
        process.stdout.write(
          `${JSON.stringify(
            {
              kind: STRICT_KIND,
              schemaVersion: STRICT_SCHEMA_VERSION,
              ok: true,
              proof: {
                kind: proof?.kind ?? null,
                schemaVersion: proof?.schemaVersion ?? null,
                digest: proof?.proofDigest ?? null,
              },
              conformance: {
                failures: conformance.failures,
                warnings: conformance.warnings,
                checks: conformance.checks,
              },
            },
            null,
            2,
          )}\n`,
        );
      }
    }
  } catch (error) {
    if (process.exitCode !== 1) {
      reportFailure(
        'E_PACKED_STRICT_UNEXPECTED',
        error instanceof Error ? error.message : String(error),
      );
    }
  } finally {
    try {
      safeCleanup(temporaryWorkspace);
    } catch (error) {
      if (process.exitCode !== 1) {
        reportFailure(
          'E_PACKED_STRICT_CLEANUP_FAILED',
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }
}
