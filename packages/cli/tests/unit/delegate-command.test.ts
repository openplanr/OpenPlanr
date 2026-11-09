import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DELEGATE_CONTRACT_VERSION,
  DELEGATE_INTEGRATION_ACTIONS,
  DELEGATE_RUN_ACTIONS,
  delegateNext,
  runDelegateAction,
} from '../../src/services/delegate-runtime-service.js';

const CLI = resolve('src/cli/index.ts');
const TSX_CLI = createRequire(import.meta.url).resolve('tsx/cli');
const TIMEOUT_MS = 30_000;
const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function delegate(args: string[], input?: string) {
  const home = mkdtempSync(join(tmpdir(), 'planr-delegate-cli-'));
  homes.push(home);
  const result = spawnSync(process.execPath, [TSX_CLI, CLI, 'delegate', ...args], {
    encoding: 'utf8',
    input,
    env: {
      PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
      HOME: home,
      NO_COLOR: '1',
    },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, home };
}

describe('openplanr delegate', () => {
  it(
    'probes the host with the stable success envelope',
    () => {
      const { status, stdout, stderr } = delegate(['probe', '--json']);
      expect(status, stderr).toBe(0);
      const envelope = JSON.parse(stdout);
      expect(envelope).toMatchObject({
        ok: true,
        action: 'probe',
        contractVersion: DELEGATE_CONTRACT_VERSION,
        result: { localExecutable: true, profiles: [] },
      });
      expect(envelope.next).toMatch(/openplanr delegate prepare/u);
    },
    TIMEOUT_MS,
  );

  it(
    'prints a short summary with a Next line without --json',
    () => {
      const { status, stdout } = delegate(['probe']);
      expect(status).toBe(0);
      expect(stdout).toMatch(/^Delegate probe: host (?:not )?ready$/mu);
      expect(stdout).toMatch(/^ {2}Profiles: none saved$/mu);
      expect(stdout).toMatch(/^Next: /mu);
    },
    TIMEOUT_MS,
  );

  it(
    'rejects input that is not one JSON object, with a recovery step',
    () => {
      const { status, stdout } = delegate(['status', '--input', '-', '--json'], '[1]');
      expect(status).toBe(1);
      expect(JSON.parse(stdout)).toMatchObject({
        ok: false,
        action: 'status',
        code: 'E_DELEGATE_INPUT',
        problem: 'Input from stdin must be one JSON object.',
        recovery: expect.stringContaining('openplanr delegate status --help'),
      });
    },
    TIMEOUT_MS,
  );

  it(
    'rejects a --run that disagrees with the input runId',
    () => {
      const home = mkdtempSync(join(tmpdir(), 'planr-delegate-input-'));
      homes.push(home);
      const file = join(home, 'input.json');
      writeFileSync(file, JSON.stringify({ runId: 'first' }));
      const { status, stdout } = delegate(['status', '--input', file, '--run', 'second', '--json']);
      expect(status).toBe(1);
      expect(JSON.parse(stdout)).toMatchObject({
        code: 'E_DELEGATE_INPUT',
        problem: '--run second differs from the input runId first.',
      });
    },
    TIMEOUT_MS,
  );

  it(
    'names an unknown run and how to recover',
    () => {
      const { status, stdout } = delegate(['status', '--run', 'missing-run', '--json']);
      expect(status).toBe(1);
      expect(JSON.parse(stdout)).toMatchObject({
        ok: false,
        code: 'E_RUN_NOT_FOUND',
        problem: expect.stringContaining('missing-run'),
        recovery: 'Use the runId that prepare returned, or prepare a new run.',
      });
    },
    TIMEOUT_MS,
  );

  it(
    'documents every runtime action with its own help',
    () => {
      const { stdout } = delegate(['--help']);
      for (const action of [...DELEGATE_RUN_ACTIONS, 'integrate'])
        expect(stdout).toContain(`  ${action}`);
      const integrate = delegate(['integrate', '--help']).stdout;
      for (const action of DELEGATE_INTEGRATION_ACTIONS) expect(integrate).toContain(`  ${action}`);
      expect(delegate(['dispatch', '--help']).stdout).toContain(
        'openplanr delegate dispatch --run <runId> --json',
      );
    },
    TIMEOUT_MS,
  );
});

describe('delegate runtime envelope', () => {
  const failing = (error: unknown) => ({
    run: () => Promise.reject(error),
    integrate: () => Promise.reject(error),
    failure: () => ({
      code: 'E_CAPSULE_SECRET',
      message: 'A required source holds a possible credential.',
      runId: 'run-1',
      details: { findings: [{ id: 'f1', contentDigest: 'sha256:abc' }] },
    }),
  });

  it('keeps the run and safe details the skill needs to recover', async () => {
    const envelope = await runDelegateAction(
      'prepare',
      {},
      { runtime: failing(new Error('blocked')) },
    );
    expect(envelope).toEqual({
      ok: false,
      action: 'prepare',
      contractVersion: DELEGATE_CONTRACT_VERSION,
      code: 'E_CAPSULE_SECRET',
      problem: 'A required source holds a possible credential.',
      recovery: expect.stringContaining('credentialResolutions'),
      runId: 'run-1',
      details: { findings: [{ id: 'f1', contentDigest: 'sha256:abc' }] },
    });
  });

  it('routes integration actions to the integration entry', async () => {
    const calls: string[] = [];
    const runtime = {
      run: async (action: string) => {
        calls.push(`run ${action}`);
        return {};
      },
      integrate: async (action: string) => {
        calls.push(`integrate ${action}`);
        return { runId: 'run-1', ready: true };
      },
      failure: () => ({ code: 'E_DELEGATE_UNKNOWN', message: 'unused' }),
    };
    const envelope = await runDelegateAction('integrate review', { runId: 'run-1' }, { runtime });
    expect(calls).toEqual(['integrate review']);
    expect(envelope).toMatchObject({ ok: true, result: { ready: true } });
    expect(envelope.ok && envelope.next).toMatch(/integrate apply/u);
  });

  it("prefers the runtime's own next action", () => {
    expect(delegateNext('status', { nextAction: 'Answer the question and resume.' })).toBe(
      'Answer the question and resume.',
    );
    expect(delegateNext('prepare', { runId: 'run-1' })).toContain(
      'openplanr delegate dispatch --run run-1 --json',
    );
  });

  it('reports the CLI version the skills record for the delegate contract', () => {
    const { commands } = JSON.parse(
      readFileSync(resolve('../../scripts/skills/skill-cli-contracts.json'), 'utf8'),
    ) as { commands: Record<string, { contracts: Record<string, string> }> };
    const contracts = commands.delegate?.contracts ?? {};
    const newest = Math.max(...Object.keys(contracts).map(Number));
    expect(contracts[String(newest)]).toBe(DELEGATE_CONTRACT_VERSION);
  });
});
