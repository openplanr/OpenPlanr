import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readLandingPrepareRequestV1, registerLandCommand } from '../src/cli/commands/land.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'planr-landing-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const write = (name: string, body: string): string => {
  const path = join(dir, name);
  writeFileSync(path, body);
  return path;
};

const validRequest = {
  feature: 'live-evidence-outcomes-and-governed-landing',
  receiptHash: `sha256:${'a'.repeat(64)}`,
  operations: [],
};

describe('landing prepare request', () => {
  it('accepts one closed request object', async () => {
    const parsed = await readLandingPrepareRequestV1(
      write('ok.json', JSON.stringify(validRequest)),
    );
    expect(parsed.feature).toBe(validRequest.feature);
  });

  it('rejects an unknown field rather than ignoring it', async () => {
    // A landing request authorizes real external effects; silently dropping an
    // unrecognized field would hide what the owner thought they were approving.
    const path = write('extra.json', JSON.stringify({ ...validRequest, autoApprove: true }));
    await expect(readLandingPrepareRequestV1(path)).rejects.toMatchObject({
      code: 'E_LANDING_REQUEST_INVALID',
    });
  });

  it('rejects malformed JSON', async () => {
    await expect(readLandingPrepareRequestV1(write('bad.json', '{'))).rejects.toMatchObject({
      code: 'E_LANDING_REQUEST_INVALID',
    });
  });

  it('rejects a JSON array', async () => {
    await expect(readLandingPrepareRequestV1(write('arr.json', '[]'))).rejects.toMatchObject({
      code: 'E_LANDING_REQUEST_INVALID',
    });
  });
});

describe('land command surface', () => {
  const build = (calls: string[]) => {
    const program = new Command();
    program.exitOverride();
    program.option('--project-dir <dir>', 'project directory', dir);
    registerLandCommand(program, {
      createService: () =>
        ({
          prepare: async () => {
            calls.push('prepare');
            return { ok: true };
          },
          show: async () => {
            calls.push('show');
            return { ok: true };
          },
          status: async () => {
            calls.push('status');
            return { ok: true };
          },
          advance: async () => {
            calls.push('advance');
            return { ok: true };
          },
        }) as never,
      authorityContext: () => ({ agent: false, hook: false }),
    });
    return program;
  };

  it('exposes prepare, show, status, and advance', () => {
    const names = build([])
      .commands.find((entry) => entry.name() === 'land')
      ?.commands.map((entry) => entry.name())
      .sort();
    expect(names).toEqual(['advance', 'prepare', 'show', 'status']);
  });

  it('refuses a plan identity that is not an exact land_ id, before reaching the service', async () => {
    const calls: string[] = [];
    const program = build(calls);
    await program.parseAsync(['node', 'planr', 'land', 'show', 'not-a-plan-id']);
    expect(calls).toEqual([]);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it('refuses an operation identity that is not an exact lop_ id', async () => {
    const calls: string[] = [];
    const program = build(calls);
    await program.parseAsync([
      'node',
      'planr',
      'land',
      'advance',
      `land_${'a'.repeat(24)}`,
      '--operation',
      'not-an-operation',
    ]);
    expect(calls).toEqual([]);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});
