import { Readable } from 'node:stream';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeOperateAction: vi.fn(),
  isNonInteractive: vi.fn(() => false),
  displayLine: vi.fn(),
  promptConfirm: vi.fn(),
}));

vi.mock('../../src/services/operate/index.js', () => ({
  executeOperateAction: mocks.executeOperateAction,
}));

vi.mock('../../src/services/interactive-state.js', () => ({
  isNonInteractive: mocks.isNonInteractive,
}));

vi.mock('../../src/services/prompt-service.js', () => ({
  promptCheckbox: vi.fn(),
  promptConfirm: mocks.promptConfirm,
  promptMultiText: vi.fn(),
  promptSecret: vi.fn(),
  promptSelect: vi.fn(),
  promptText: vi.fn(),
}));

vi.mock('../../src/utils/logger.js', () => ({
  display: {
    blank: vi.fn(),
    heading: vi.fn(),
    line: mocks.displayLine,
  },
  logger: {
    dim: vi.fn(),
    heading: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
  },
}));

import { registerOperateCommand } from '../../src/cli/commands/operate.js';

const originalStdin = Object.getOwnPropertyDescriptor(process, 'stdin');
const originalExitCode = process.exitCode;

function createProgram(): Command {
  const program = new Command()
    .name('planr')
    .exitOverride()
    .option('--project-dir <path>', 'project directory', '/workspace')
    .option('--yes', 'confirm actions', false)
    .option('--json', 'emit JSON', false);
  program.configureOutput({
    writeErr: () => undefined,
    writeOut: () => undefined,
  });
  registerOperateCommand(program);
  return program;
}

async function parse(program: Command, args: string[]): Promise<void> {
  await program.parseAsync(['node', 'planr', ...args]);
}

function commandPaths(command: Command, prefix: string[] = []): string[] {
  return command.commands.flatMap((child) => {
    const path = [...prefix, child.name()];
    return [path.join(' '), ...commandPaths(child, path)];
  });
}

function replaceStdin(chunks: Array<string | Buffer>, options: { isTTY?: boolean } = {}): void {
  const stream = Readable.from(chunks);
  if (options.isTTY !== undefined) {
    Object.defineProperty(stream, 'isTTY', {
      configurable: true,
      value: options.isTTY,
    });
  }
  Object.defineProperty(process, 'stdin', {
    configurable: true,
    value: stream,
  });
}

beforeEach(() => {
  mocks.executeOperateAction.mockReset();
  mocks.executeOperateAction.mockResolvedValue({
    ok: true,
    action: 'test',
    schemaVersion: '1.0.0',
  });
  mocks.isNonInteractive.mockReset();
  mocks.isNonInteractive.mockReturnValue(false);
  mocks.displayLine.mockReset();
  mocks.promptConfirm.mockReset();
  mocks.promptConfirm.mockResolvedValue(false);
  process.exitCode = undefined;
});

afterEach(() => {
  if (originalStdin) Object.defineProperty(process, 'stdin', originalStdin);
  process.exitCode = originalExitCode;
});

describe('operate command contract', () => {
  it('registers the complete public and machine command tree', () => {
    const program = createProgram();
    expect(commandPaths(program).sort()).toEqual(
      [
        'operate',
        'operate adapter',
        'operate adapter cancel',
        'operate adapter finalize',
        'operate adapter prepare',
        'operate adapter record',
        'operate adapter resume',
        'operate brief',
        'operate cache',
        'operate cache purge',
        'operate cache status',
        'operate config',
        'operate config edit',
        'operate config show',
        'operate config validate',
        'operate cycles',
        'operate cycles cancel',
        'operate cycles close',
        'operate cycles list',
        'operate cycles recover',
        'operate cycles resume',
        'operate cycles show',
        'operate decisions',
        'operate decisions decide',
        'operate decisions list',
        'operate decisions show',
        'operate demo',
        'operate diagnostics',
        'operate diagnostics export',
        'operate evidence',
        'operate evidence list',
        'operate evidence show',
        'operate findings',
        'operate findings accept',
        'operate findings list',
        'operate findings reject',
        'operate findings show',
        'operate findings supersede',
        'operate gaps',
        'operate gaps answer',
        'operate gaps list',
        'operate gaps show',
        'operate gaps verify',
        'operate init',
        'operate inspect',
        'operate integrity',
        'operate integrity enable',
        'operate integrity status',
        'operate migrate',
        'operate migrate apply',
        'operate migrate inspect',
        'operate migrations',
        'operate migrations list',
        'operate migrations rollback',
        'operate migrations show',
        'operate profiles',
        'operate profiles list',
        'operate profiles show',
        'operate profiles validate',
        'operate report',
        'operate review',
        'operate routes',
        'operate routes apply',
        'operate routes list',
        'operate routes rollback',
        'operate routes show',
        'operate run',
        'operate security',
        'operate security repair',
        'operate status',
      ].sort(),
    );

    const operate = program.commands.find((command) => command.name() === 'operate');
    expect(operate?.helpInformation()).toContain(
      'Turn verified product evidence into governed DEV, OWNER, and AGENT routes',
    );
    expect(operate?.helpInformation()).toContain('inspect');
    expect(operate?.helpInformation()).toContain('adapter');
    const routes = operate?.commands.find((command) => command.name() === 'routes');
    expect(routes?.helpInformation()).toContain('apply');
    expect(routes?.helpInformation()).toContain('rollback');
  });

  it('makes --json execution strictly non-interactive and emits one JSON result', async () => {
    const program = createProgram();
    const result = {
      ok: true,
      action: 'inspect',
      schemaVersion: '1.0.0',
      data: { ready: true },
    };
    mocks.executeOperateAction.mockResolvedValue(result);

    await parse(program, ['--project-dir', '/tmp/product', 'operate', 'inspect', '--json']);

    expect(mocks.executeOperateAction).toHaveBeenCalledOnce();
    expect(mocks.executeOperateAction).toHaveBeenCalledWith({
      action: 'inspect',
      arguments: {},
      interactive: false,
      options: expect.objectContaining({
        json: true,
        yes: false,
      }),
      projectRoot: '/tmp/product',
    });
    expect(mocks.isNonInteractive).not.toHaveBeenCalled();
    expect(mocks.displayLine).toHaveBeenCalledOnce();
    expect(mocks.displayLine).toHaveBeenCalledWith(JSON.stringify(result));
  });

  it('keeps credential-free human inspect and demo output concise', async () => {
    const inspectProgram = createProgram();
    mocks.executeOperateAction.mockResolvedValueOnce({
      ok: true,
      action: 'inspect',
      schemaVersion: '1.0.0',
      message: 'Operating Board is available.',
      data: {
        project: true,
        initialized: false,
        pipeline: { available: true, protocolVersion: '1.2.0' },
        commitSafeRoot: '.planr/operate',
        machineLocalState: '~/.planr/operate/<project-hash>',
      },
    });

    await parse(inspectProgram, ['operate', 'inspect']);

    expect(mocks.displayLine.mock.calls.map(([line]) => line)).toEqual([
      'Project context: detected',
      'Initialization: not configured',
      'Pipeline: Protocol 1.2.0 ready',
      'Commit-safe state: .planr/operate',
      'Machine-local data: ~/.planr/operate/<project-hash>',
    ]);

    mocks.displayLine.mockReset();
    const demoProgram = createProgram();
    mocks.executeOperateAction.mockResolvedValueOnce({
      ok: true,
      action: 'demo',
      schemaVersion: '1.0.0',
      message: 'Generated a deterministic demonstration.',
      data: {
        brief: '# OpenPlanr Operating Brief\n\nOne cited action.',
        evidence: [{ id: 'EVD-001' }, { id: 'EVD-002' }],
        state: { intentionally: 'hidden in human mode' },
        note: 'Demo performs no provider/model calls and writes no project state.',
      },
    });

    await parse(demoProgram, ['operate', 'demo']);

    expect(mocks.displayLine.mock.calls.map(([line]) => line)).toEqual([
      '# OpenPlanr Operating Brief\n\nOne cited action.',
      'Evidence: 2 sanitized deterministic records',
      'Demo performs no provider/model calls and writes no project state.',
    ]);
  });

  // FR3 / E-003 — the human review gate renders the report Markdown the service
  // pre-selects as a string, never a raw `JSON.stringify` of the state object.
  it('renders the review gate as Markdown by default and raw state only under --json', async () => {
    const markdown = '# OpenPlanr Operating Brief — CYCLE-001\n\n## Chair\n\n- No route applied.';
    const humanProgram = createProgram();
    mocks.executeOperateAction.mockResolvedValueOnce({
      ok: true,
      action: 'review',
      schemaVersion: '1.0.0',
      protocolVersion: '1.2.0',
      message: 'This is the mandatory human review gate. No route has been applied.',
      data: markdown,
    });

    await parse(humanProgram, ['operate', 'review', 'CYCLE-001']);

    expect(mocks.displayLine).toHaveBeenCalledWith(markdown);
    expect(mocks.displayLine.mock.calls.every(([line]) => !/^\{/.test(String(line)))).toBe(true);

    // --json keeps returning the exact raw state object, emitted as one JSON line.
    mocks.displayLine.mockReset();
    const jsonProgram = createProgram();
    const rawState = {
      ok: true,
      action: 'review',
      schemaVersion: '1.0.0',
      protocolVersion: '1.2.0',
      data: { kind: 'operating-state', cycles: [{ id: 'CYCLE-001', state: 'reviewable' }] },
    };
    mocks.executeOperateAction.mockResolvedValueOnce(rawState);

    await parse(jsonProgram, ['operate', 'review', 'CYCLE-001', '--json']);

    expect(mocks.displayLine).toHaveBeenCalledOnce();
    expect(mocks.displayLine).toHaveBeenCalledWith(JSON.stringify(rawState));
  });

  it('forwards repeatable and boolean options without losing defaults', async () => {
    const program = createProgram();

    await parse(program, [
      'operate',
      'run',
      '--cycle-id',
      'CYCLE-007',
      '--focus',
      'growth',
      '--focus',
      'technology',
      '--depth',
      'deep',
      '--runtime',
      'codex',
      '--offline',
      '--review-only',
      '--preview',
      '--yes',
      '--json',
    ]);

    expect(mocks.executeOperateAction).toHaveBeenCalledWith({
      action: 'run',
      arguments: {},
      interactive: false,
      options: expect.objectContaining({
        depth: 'deep',
        cycleId: 'CYCLE-007',
        dryRun: false,
        focus: ['growth', 'technology'],
        json: true,
        offline: true,
        preview: true,
        reviewOnly: true,
        runtime: 'codex',
        yes: true,
      }),
      projectRoot: '/workspace',
    });
  });

  it('forwards bounded guided answer stdin and session lifecycle options', async () => {
    const program = createProgram();
    const input = '{"kind":"guided-answer-envelope"}';
    replaceStdin([input]);

    await parse(program, ['operate', 'init', '--resume', 'GIS-12345678', '--stdin', '--json']);

    expect(mocks.executeOperateAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'init',
        interactive: false,
        stdin: input,
        options: expect.objectContaining({
          resume: 'GIS-12345678',
          stdin: true,
          json: true,
        }),
      }),
    );

    const cancelled = createProgram();
    await parse(cancelled, [
      'operate',
      'init',
      '--resume',
      'GIS-12345678',
      '--cancel-session',
      '--json',
    ]);
    expect(mocks.executeOperateAction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'init',
        options: expect.objectContaining({
          resume: 'GIS-12345678',
          cancelSession: true,
        }),
      }),
    );
  });

  it('fails immediately when --stdin is launched on an attached terminal without input', async () => {
    const program = createProgram();
    replaceStdin([], { isTTY: true });

    await parse(program, ['operate', 'init', '--resume', 'GIS-12345678', '--stdin', '--json']);

    expect(mocks.executeOperateAction).not.toHaveBeenCalled();
    expect(mocks.displayLine).toHaveBeenCalledOnce();
    expect(JSON.parse(String(mocks.displayLine.mock.calls[0]?.[0]))).toMatchObject({
      schemaVersion: '1.0.0',
      protocolVersion: '1.2.0',
      ok: false,
      action: 'init',
      code: 'E_OPERATE_STDIN_REQUIRED',
      next: ['Attach one bounded JSON document to stdin before launching this exact command.'],
      exitCode: 2,
    });
    expect(process.exitCode).toBe(2);
  });

  it('previews and confirms interactive initialization before writing', async () => {
    const program = createProgram();
    mocks.executeOperateAction
      .mockResolvedValueOnce({
        ok: true,
        action: 'init',
        schemaVersion: '1.0.0',
        protocolVersion: '1.2.0',
        preview: {
          previewDigest: `sha256:${'a'.repeat(64)}`,
          previewCreatedAt: '2026-07-29T10:00:00.000Z',
          changedPaths: ['.planr/operate/config.json'],
        },
        actions: [
          {
            id: 'operate.init.apply',
            confirmationDigest: `sha256:${'b'.repeat(64)}`,
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        action: 'init',
        schemaVersion: '1.0.0',
        protocolVersion: '1.2.0',
      });
    mocks.promptConfirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await parse(program, [
      'operate',
      'init',
      '--profile',
      'saas',
      '--decision-owner',
      'Product owner',
      '--planning-engine',
      'openplanr',
      '--runtime',
      'codex',
      '--cadence',
      'weekly',
      '--timezone',
      'Europe/Istanbul',
      '--sensitivity-ceiling',
      'internal',
      '--purpose',
      'Help technical founders operate one SaaS with evidence.',
      '--product-stage',
      'growth',
      '--business-model',
      'Subscription SaaS',
      '--ideal-customer',
      'Technical founders and product-engineering leads',
      '--goal',
      'Produce a cited operating brief',
      '--success-metric',
      'First useful brief within five minutes',
      '--guardrail',
      'Never invoke SHIP automatically',
      '--known-unknown',
      'Which product signal will become the leading indicator',
    ]);

    expect(mocks.executeOperateAction).toHaveBeenCalledTimes(2);
    expect(mocks.executeOperateAction.mock.calls[0]?.[0]).toMatchObject({
      action: 'init',
      options: expect.objectContaining({ preview: true, yes: false }),
    });
    expect(mocks.promptConfirm).toHaveBeenNthCalledWith(
      1,
      'Apply this exact Operating Board configuration?',
      true,
    );
    expect(mocks.executeOperateAction.mock.calls[1]?.[0]).toMatchObject({
      action: 'init',
      options: expect.objectContaining({
        preview: false,
        yes: true,
        confirm: `sha256:${'b'.repeat(64)}`,
        previewCreatedAt: '2026-07-29T10:00:00.000Z',
      }),
    });
  });

  it('forwards route previews without a confirmation digest or writes', async () => {
    const program = createProgram();

    await parse(program, ['operate', 'routes', 'apply', 'ACT-001', '--preview', '--json']);

    expect(mocks.executeOperateAction).toHaveBeenCalledWith({
      action: 'routes.apply',
      arguments: { routeId: 'ACT-001' },
      interactive: false,
      options: expect.objectContaining({
        dryRun: false,
        json: true,
        preview: true,
        yes: false,
      }),
      projectRoot: '/workspace',
    });
  });

  it('previews and confirms a route before interactive application', async () => {
    const program = createProgram();
    const previewDigest = `sha256:${'b'.repeat(64)}`;
    mocks.executeOperateAction
      .mockResolvedValueOnce({
        ok: true,
        action: 'routes.apply',
        schemaVersion: '1.0.0',
        protocolVersion: '1.2.0',
        data: { previewDigest, writesCommitted: false },
      })
      .mockResolvedValueOnce({
        ok: true,
        action: 'routes.apply',
        schemaVersion: '1.0.0',
        protocolVersion: '1.2.0',
      });
    mocks.promptConfirm.mockResolvedValueOnce(true);

    await parse(program, ['operate', 'routes', 'apply', 'ACT-001']);

    expect(mocks.executeOperateAction).toHaveBeenCalledTimes(2);
    expect(mocks.executeOperateAction.mock.calls[0]?.[0]).toMatchObject({
      action: 'routes.apply',
      options: expect.objectContaining({ preview: true, yes: false }),
    });
    expect(mocks.promptConfirm).toHaveBeenCalledWith(
      'Apply route ACT-001 using this exact preview digest?',
      true,
    );
    expect(mocks.executeOperateAction.mock.calls[1]?.[0]).toMatchObject({
      action: 'routes.apply',
      options: expect.objectContaining({
        preview: false,
        previewDigest,
        yes: true,
      }),
    });
  });

  it('discloses and explicitly confirms first-use provider consent before retrying a run', async () => {
    const program = createProgram();
    mocks.executeOperateAction
      // FR7/E-007: first-use provider consent is a healthy `ok: true` handoff
      // (flow: 'handoff'), not an exit-4 failure — the CLI still discloses the
      // policy and retries with explicit authority.
      .mockResolvedValueOnce({
        ok: true,
        flow: 'handoff',
        action: 'run',
        schemaVersion: '1.0.0',
        protocolVersion: '1.2.0',
        code: 'E_OPERATE_AUTHORITY_REQUIRED',
        message: 'Provider policy approval is required.',
        data: {
          endpoint: { display: 'configured-ai-provider' },
          permittedDataClasses: ['source-code'],
          retention: { maxProviderRetentionDays: 30 },
          limits: { maxCostUsd: 2 },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        action: 'run',
        schemaVersion: '1.0.0',
        protocolVersion: '1.2.0',
      });
    mocks.promptConfirm.mockResolvedValue(true);

    await parse(program, ['operate', 'run']);

    expect(mocks.promptConfirm).toHaveBeenCalledWith(
      'Approve the disclosed provider policy for this operating run?',
      false,
    );
    expect(mocks.executeOperateAction).toHaveBeenCalledTimes(2);
    expect(mocks.executeOperateAction.mock.calls[1]?.[0]).toMatchObject({
      action: 'run',
      interactive: true,
      options: expect.objectContaining({ yes: true }),
    });
    expect(process.exitCode).toBeUndefined();
  });

  it('never prompts or retries provider consent in JSON mode', async () => {
    const program = createProgram();
    // The JSON surface receives the same `ok: true` handoff and keeps a clean
    // exit code — a harness discriminates on `flow: 'handoff'`, never a red exit.
    mocks.executeOperateAction.mockResolvedValue({
      ok: true,
      flow: 'handoff',
      action: 'run',
      schemaVersion: '1.0.0',
      protocolVersion: '1.2.0',
      code: 'E_OPERATE_AUTHORITY_REQUIRED',
      message: 'Provider policy approval is required.',
    });

    await parse(program, ['operate', 'run', '--json']);

    expect(mocks.promptConfirm).not.toHaveBeenCalled();
    expect(mocks.executeOperateAction).toHaveBeenCalledOnce();
    expect(process.exitCode).toBeUndefined();
  });

  it('accepts stdin at the 64 KiB boundary and forwards it verbatim', async () => {
    const program = createProgram();
    const input = Buffer.alloc(64 * 1024, 0x61);
    replaceStdin([input]);

    await parse(program, ['operate', 'gaps', 'answer', 'GAP-001', '--stdin', '--yes', '--json']);

    expect(mocks.executeOperateAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'gaps.answer',
        arguments: { gapId: 'GAP-001' },
        interactive: false,
        stdin: input.toString('utf8'),
      }),
    );
  });

  it('forwards repeatable evidence references for explicit gap verification', async () => {
    const program = createProgram();

    await parse(program, [
      'operate',
      'gaps',
      'verify',
      'GAP-001',
      '--evidence-ref',
      'EVD-001',
      '--evidence-ref',
      'EVD-002',
      '--yes',
      '--json',
    ]);

    expect(mocks.executeOperateAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'gaps.verify',
        arguments: { gapId: 'GAP-001' },
        interactive: false,
        options: expect.objectContaining({
          evidenceRef: ['EVD-001', 'EVD-002'],
          yes: true,
        }),
      }),
    );
  });

  it('returns one versioned class-2 JSON error for stdin larger than 64 KiB', async () => {
    const program = createProgram();
    replaceStdin([Buffer.alloc(64 * 1024 + 1, 0x61)]);

    await parse(program, [
      'operate',
      'decisions',
      'decide',
      'DECISION-001',
      '--stdin',
      '--yes',
      '--json',
    ]);

    expect(mocks.executeOperateAction).not.toHaveBeenCalled();
    expect(mocks.displayLine).toHaveBeenCalledOnce();
    expect(JSON.parse(String(mocks.displayLine.mock.calls[0]?.[0]))).toMatchObject({
      schemaVersion: '1.0.0',
      protocolVersion: '1.2.0',
      ok: false,
      action: 'decisions.decide',
      code: 'E_OPERATE_INPUT_TOO_LARGE',
      paths: {},
      counts: {},
      warnings: [],
      exitCode: 2,
    });
    expect(process.exitCode).toBe(2);
  });
});
