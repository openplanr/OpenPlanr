// @vitest-environment node

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerLandCommand } from '../../src/cli/commands/land.js';
import {
  LandingServiceError,
  type LandingServiceV1,
} from '../../src/services/landing/landing-service.js';

const planId = `land_${'1'.repeat(32)}`;
const operationId = `lop_${'2'.repeat(32)}`;
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

function requestFile(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'openplanr-land-command-'));
  roots.push(root);
  const target = path.join(root, 'request.json');
  writeFileSync(
    target,
    JSON.stringify({
      feature: 'landing-test',
      receiptHash: `sha256:${'3'.repeat(64)}`,
      operations: [{ operationId }],
    }),
  );
  return target;
}

function program(service?: Partial<LandingServiceV1>): Command {
  const command = new Command().exitOverride();
  command.option('--project-dir <path>', 'project', '/disposable/project');
  command.option('--yes', 'noninteractive', false);
  command.option('--no-interactive', 'disable interaction');
  registerLandCommand(command, service ? { createService: () => service as LandingServiceV1 } : {});
  return command;
}

describe('land CLI boundary', () => {
  it('keeps prepare, show, and status read-only and machine-readable', async () => {
    const prepare = vi.fn(async () => ({
      ok: true,
      operation: 'landing.prepare',
      authority: 'none',
      effects: [],
    }));
    const show = vi.fn(async () => ({
      ok: true,
      operation: 'landing.show',
      authority: 'none',
      effects: [],
    }));
    const status = vi.fn(async () => ({
      ok: true,
      operation: 'landing.status',
      authority: 'none',
    }));
    const advance = vi.fn();
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const service = { prepare, show, status, advance };

    await program(service).parseAsync([
      'node',
      'planr',
      'land',
      'prepare',
      '--request-file',
      requestFile(),
      '--json',
    ]);
    await program(service).parseAsync(['node', 'planr', 'land', 'show', planId, '--json']);
    await program(service).parseAsync(['node', 'planr', 'land', 'status', planId, '--json']);

    expect(prepare).toHaveBeenCalledOnce();
    expect(show).toHaveBeenCalledWith(planId);
    expect(status).toHaveBeenCalledWith(planId);
    expect(advance).not.toHaveBeenCalled();
    expect(output.mock.calls.map(([value]) => JSON.parse(String(value)).authority)).toEqual([
      'none',
      'none',
      'none',
    ]);
  });

  it.each([
    { argv: ['--yes'], code: 'E_LANDING_MACHINE_AUTHORITY_FORBIDDEN' },
    { argv: ['--no-interactive'], code: 'E_LANDING_OWNER_INTERACTIVE_REQUIRED' },
  ])(
    'passes machine refusal custody to the service before effects: $code',
    async ({ argv, code }) => {
      const dispatch = vi.fn();
      const advance = vi.fn(async (input: { yes?: boolean; ownerInteractive: boolean }) => {
        throw new LandingServiceError(
          input.yes
            ? 'E_LANDING_MACHINE_AUTHORITY_FORBIDDEN'
            : 'E_LANDING_OWNER_INTERACTIVE_REQUIRED',
          'Landing owner authority is unavailable.',
        );
      });
      const output = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await program({ advance }).parseAsync([
        'node',
        'planr',
        ...argv,
        'land',
        'advance',
        planId,
        '--operation',
        operationId,
      ]);

      expect(advance).toHaveBeenCalledOnce();
      expect(dispatch).not.toHaveBeenCalled();
      expect(output.mock.calls.flat().map(String).join(' ')).toContain(code);
    },
  );

  it('refuses a hostless production command with a bounded path-free envelope', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await program().parseAsync(['node', 'planr', 'land', 'status', planId, '--json']);
    const result = JSON.parse(String(output.mock.calls.at(-1)?.[0]));
    expect(result).toMatchObject({ ok: false, code: 'E_LANDING_HOST_NOT_CONFIGURED' });
    expect(JSON.stringify(result)).not.toContain('/disposable/project');
  });
});
