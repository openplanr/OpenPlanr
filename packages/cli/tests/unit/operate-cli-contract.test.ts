import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dispatchMock = vi.hoisted(() => vi.fn());
const domainListMock = vi.hoisted(() => vi.fn());
const storageStatusMock = vi.hoisted(() => vi.fn());
const storageMigrationMock = vi.hoisted(() => vi.fn());
const temporaryRoots: string[] = [];
const originalStdin = Object.getOwnPropertyDescriptor(process, 'stdin');

vi.mock('../../src/services/operate/client.js', () => ({
  createOperateClient: () => ({ dispatch: dispatchMock }),
}));
vi.mock('../../src/services/operate/domain-catalog-service.js', () => ({
  listInstalledPublicOperatingDomains: domainListMock,
}));
vi.mock('../../src/services/operate/storage-migration-service.js', () => ({
  readOperateStorageStatus: storageStatusMock,
  migrateProjectOperateStorage: storageMigrationMock,
}));

import type {
  OperateNoteContractVersionSelector,
  OperateNoteValidationProfile,
  OperateNoteValidationResult,
} from '../../src/cli/commands/operate/registrars/contracts.js';
import { registerOperateNoteValidationCommand } from '../../src/cli/commands/operate/registrars/note-validation.js';
import { registerOperateCommand } from '../../src/cli/commands/operate.js';

function temporaryFile(name: string, content: string | Uint8Array): string {
  const root = mkdtempSync(path.join(tmpdir(), 'openplanr-cli-contract-'));
  temporaryRoots.push(root);
  const target = path.join(root, name);
  writeFileSync(target, content);
  return target;
}

function framingFile(content: string | Uint8Array): string {
  return temporaryFile('framing.json', content);
}

function stdinBytes(content: string | Uint8Array): void {
  Object.defineProperty(process, 'stdin', {
    configurable: true,
    value: Readable.from([content]),
  });
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  if (originalStdin) Object.defineProperty(process, 'stdin', originalStdin);
  process.exitCode = undefined;
});

function program(): Command {
  const command = new Command();
  command.exitOverride();
  command.option('--project-dir <path>', 'project directory', '/tmp/openplanr-cli-contract');
  registerOperateCommand(command);
  return command;
}

function noteProgram(
  inspectOperateReviewNote: (
    markdown: string,
    options: {
      profile: OperateNoteValidationProfile;
      contractVersion?: OperateNoteContractVersionSelector;
    },
  ) => Promise<OperateNoteValidationResult>,
): Command {
  const command = new Command();
  command.exitOverride();
  command.configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
  const operate = command.command('operate');
  registerOperateNoteValidationCommand(operate, { inspectOperateReviewNote });
  return command;
}

describe('Operate assignment CLI contract', () => {
  beforeEach(() => {
    dispatchMock.mockReset();
    dispatchMock.mockResolvedValue({
      ok: true,
      operation: 'operate.assignment.submit',
      data: {},
      allowedActions: [],
    });
    domainListMock.mockReset();
    domainListMock.mockResolvedValue([
      {
        domainId: 'business',
        domainVersion: '1.0.0',
        domainContract: {
          apiDomainId: 'business',
          id: 'business-domain',
          version: '1.0.0',
        },
        roles: [
          {
            roleId: 'strategy-finance',
            roleKind: 'advisor',
            roleVersion: '2.0.0',
            label: 'CEO / Strategy & Finance',
          },
        ],
      },
      {
        domainId: 'software',
        domainVersion: '1.0.0',
        domainContract: {
          apiDomainId: 'software',
          id: 'software-domain',
          version: '1.0.0',
        },
        roles: [
          {
            roleId: 'operate-advisor',
            roleKind: 'advisor',
            roleVersion: '2.0.0',
            label: 'Operating Advisor',
          },
        ],
      },
    ]);
    storageStatusMock.mockReset();
    storageStatusMock.mockResolvedValue({
      kind: 'operate-storage-status',
      status: 'migration-required',
      legacySources: ['operate-v2', 'operate-legacy'],
      interruptedEntries: [],
      nextAction: 'migrate-storage',
    });
    storageMigrationMock.mockReset();
    storageMigrationMock.mockResolvedValue({
      kind: 'operate-storage-migration-receipt',
      migrated: true,
      archives: [{ archiveId: 'archive-one', source: 'operate-v2' }],
    });
  });

  it('lists exact installed public domain identities without opening runtime storage', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let line: string | undefined;
    try {
      await program().parseAsync(['node', 'planr', 'operate', 'domains', '--json']);
      line = output.mock.calls.map(([value]) => String(value)).find((value) => value[0] === '{');
    } finally {
      output.mockRestore();
    }

    expect(domainListMock).toHaveBeenCalledOnce();
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(JSON.parse(line ?? '{}')).toEqual({
      ok: true,
      operation: 'operate.domains.list',
      data: { domains: await domainListMock.mock.results[0].value },
      allowedActions: [],
    });
  });

  it('advertises domain discovery as a read-only command with JSON output', () => {
    const root = program();
    const operate = root.commands.find((command) => command.name() === 'operate');
    const domains = operate?.commands.find((command) => command.name() === 'domains');

    expect(operate?.helpInformation()).toContain('domains');
    expect(domains?.options.map(({ long }) => long)).toEqual(['--json']);
    expect(domains?.helpInformation()).not.toContain('--domain-version');

    const validateNote = operate?.commands.find((command) => command.name() === 'validate-note');
    expect(validateNote?.options.map(({ long }) => long)).toEqual([
      '--profile',
      '--contract-version',
      '--json',
    ]);
    expect(validateNote?.options[0]?.argChoices).toEqual([
      'advisor',
      'challenger',
      'chair',
      'board-report',
    ]);
    expect(validateNote?.options[1]?.argChoices).toEqual(['auto', '1.0.0', '2.0.0']);
  });

  it('requires and dispatches the exact human Decision owner at Cycle start', async () => {
    dispatchMock.mockResolvedValueOnce({
      ok: true,
      operation: 'operate.cycle.start',
      data: {},
      allowedActions: [],
    });
    await program().parseAsync([
      'node',
      'planr',
      'operate',
      'start',
      '--scope',
      'scope-one',
      '--domain',
      'business',
      '--domain-version',
      '1.0.0',
      '--owner',
      'owner-one',
      '--json',
    ]);

    expect(dispatchMock).toHaveBeenCalledWith({
      operation: 'operate.cycle.start',
      request: {
        scope: { scopeId: 'scope-one', domainId: 'business', domainVersion: '1.0.0' },
        focus: [],
        trigger: { kind: 'manual' },
        mode: 'standard',
        ownerActorId: 'owner-one',
        deliveryRoute: 'observe-only',
      },
    });
  });

  it('refuses Cycle start before dispatch when the Decision owner is omitted', async () => {
    await expect(
      program().parseAsync([
        'node',
        'planr',
        'operate',
        'start',
        '--scope',
        'scope-one',
        '--domain',
        'business',
        '--domain-version',
        '1.0.0',
      ]),
    ).rejects.toMatchObject({ code: 'commander.missingMandatoryOptionValue' });
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('refuses an unsupported delivery route before Cycle start dispatch', async () => {
    await expect(
      program().parseAsync([
        'node',
        'planr',
        'operate',
        'start',
        '--scope',
        'scope-one',
        '--domain',
        'business',
        '--domain-version',
        '1.0.0',
        '--owner',
        'owner-one',
        '--route',
        'production-deploy',
      ]),
    ).rejects.toMatchObject({ code: 'commander.invalidArgument' });
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('passes exact inline Planning framing through without filtering', async () => {
    const framing = {
      title: 'Reviewed title',
      slug: 'reviewed-title',
      problem: 'Problem',
      objective: 'Objective',
      users: ['Operators'],
      scope: ['One change'],
      nonScope: ['Automatic PLAN'],
      risks: ['Stale signal'],
      constraints: ['Restart-safe custody'],
      requirements: ['Requirement'],
      acceptanceOutcomes: ['Accepted outcome'],
      privateBody: 'must reach the closed-object validator',
    };
    await program().parseAsync([
      'node',
      'planr',
      'operate',
      'planning',
      'preview',
      'act_12345678',
      '--actor',
      'owner-one',
      '--framing-json',
      JSON.stringify(framing),
      '--json',
    ]);

    expect(dispatchMock).toHaveBeenCalledWith({
      operation: 'operate.planning.preview',
      request: {
        actionId: 'act_12345678',
        actor: { actorId: 'owner-one', kind: 'human', runtime: 'openplanr' },
        framing,
      },
    });
  });

  it.each(['[]', '{'])(
    'rejects invalid Planning framing JSON before dispatch (%s)',
    async (value) => {
      await expect(
        program().parseAsync([
          'node',
          'planr',
          'operate',
          'planning',
          'preview',
          'act_12345678',
          '--actor',
          'owner-one',
          '--framing-json',
          value,
        ]),
      ).rejects.toMatchObject({ code: 'E_OPERATE_PLANNING_INVALID' });
      expect(dispatchMock).not.toHaveBeenCalled();
    },
  );

  it('rejects simultaneous framing JSON and framing file inputs', async () => {
    await expect(
      program().parseAsync([
        'node',
        'planr',
        'operate',
        'planning',
        'preview',
        'act_12345678',
        '--actor',
        'owner-one',
        '--framing-json',
        '{}',
        '--framing-file',
        'framing.json',
      ]),
    ).rejects.toMatchObject({ code: 'commander.conflictingOption' });
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('fatally decodes framing files and forwards a foreign key for closed service validation', async () => {
    const framing = { title: 'File framing', foreignKey: 'must not be filtered' };
    await program().parseAsync([
      'node',
      'planr',
      'operate',
      'planning',
      'preview',
      'act_12345678',
      '--actor',
      'owner-one',
      '--framing-file',
      framingFile(JSON.stringify(framing)),
    ]);
    expect(dispatchMock).toHaveBeenCalledWith({
      operation: 'operate.planning.preview',
      request: {
        actionId: 'act_12345678',
        actor: { actorId: 'owner-one', kind: 'human', runtime: 'openplanr' },
        framing,
      },
    });

    for (const invalid of [Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d]), '[]']) {
      dispatchMock.mockClear();
      await expect(
        program().parseAsync([
          'node',
          'planr',
          'operate',
          'planning',
          'preview',
          'act_12345678',
          '--actor',
          'owner-one',
          '--framing-file',
          framingFile(invalid),
        ]),
      ).rejects.toMatchObject({ code: 'E_OPERATE_PLANNING_INVALID' });
      expect(dispatchMock).not.toHaveBeenCalled();
    }
  });

  it('fatally decodes framing stdin and refuses arrays without filtering foreign keys', async () => {
    const framing = { title: 'Stdin framing', foreignKey: 'must reach the service' };
    stdinBytes(JSON.stringify(framing));
    await program().parseAsync([
      'node',
      'planr',
      'operate',
      'planning',
      'preview',
      'act_12345678',
      '--actor',
      'owner-one',
      '--framing-file',
      '-',
    ]);
    expect(dispatchMock).toHaveBeenCalledWith({
      operation: 'operate.planning.preview',
      request: {
        actionId: 'act_12345678',
        actor: { actorId: 'owner-one', kind: 'human', runtime: 'openplanr' },
        framing,
      },
    });

    for (const invalid of [Buffer.from([0x7b, 0xff, 0x7d]), '[]']) {
      dispatchMock.mockClear();
      stdinBytes(invalid);
      await expect(
        program().parseAsync([
          'node',
          'planr',
          'operate',
          'planning',
          'preview',
          'act_12345678',
          '--actor',
          'owner-one',
          '--framing-file',
          '-',
        ]),
      ).rejects.toMatchObject({ code: 'E_OPERATE_PLANNING_INVALID' });
      expect(dispatchMock).not.toHaveBeenCalled();
    }
  });

  it('dispatches submit with the exact agent identity and runtime', async () => {
    await program().parseAsync([
      'node',
      'planr',
      'operate',
      'submit',
      'asg_12345678',
      '--submission',
      'sub_12345678',
      '--actor',
      'agent-ceo',
      '--runtime',
      'codex',
      '--content-base64',
      'e30=',
      '--json',
    ]);

    expect(dispatchMock).toHaveBeenCalledWith({
      operation: 'operate.assignment.submit',
      request: {
        assignmentId: 'asg_12345678',
        submissionId: 'sub_12345678',
        actor: { actorId: 'agent-ceo', kind: 'agent', runtime: 'codex' },
        contentBase64: 'e30=',
        mediaType: 'application/json',
        encoding: 'utf-8',
      },
    });
  });

  it('refuses submit before dispatch when the exact claimant actor is omitted', async () => {
    await expect(
      program().parseAsync([
        'node',
        'planr',
        'operate',
        'submit',
        'asg_12345678',
        '--submission',
        'sub_12345678',
        '--runtime',
        'codex',
        '--content-base64',
        'e30=',
      ]),
    ).rejects.toMatchObject({ code: 'commander.missingMandatoryOptionValue' });
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('dispatches human Artifact reads with explicit scope and nullable Assignment identity', async () => {
    dispatchMock.mockResolvedValueOnce({
      ok: true,
      operation: 'operate.artifact.get',
      data: {},
      allowedActions: [],
    });
    await program().parseAsync([
      'node',
      'planr',
      'operate',
      'artifact',
      'art_12345678',
      '--actor',
      'owner-one',
      '--actor-kind',
      'human',
      '--runtime',
      'openplanr',
      '--scope',
      'scope-one',
      '--domain',
      'business',
      '--domain-version',
      '1.0.0',
      '--representation',
      'raw',
      '--json',
    ]);

    expect(dispatchMock).toHaveBeenCalledWith({
      operation: 'operate.artifact.get',
      request: {
        artifactId: 'art_12345678',
        representation: 'raw',
        actor: { actorId: 'owner-one', kind: 'human', runtime: 'openplanr' },
        scope: { scopeId: 'scope-one', domainId: 'business', domainVersion: '1.0.0' },
        assignmentId: null,
      },
    });
  });

  it('requires an issued Assignment for agent Artifact reads', async () => {
    await expect(
      program().parseAsync([
        'node',
        'planr',
        'operate',
        'artifact',
        'art_12345678',
        '--actor',
        'agent-ceo',
        '--actor-kind',
        'agent',
        '--runtime',
        'codex',
        '--scope',
        'scope-one',
        '--domain',
        'business',
        '--domain-version',
        '1.0.0',
      ]),
    ).rejects.toMatchObject({ code: 'E_OPERATE_ASSIGNMENT_REQUIRED' });
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('exposes storage migration status and explicit migration as product-owned commands', async () => {
    await program().parseAsync([
      'node',
      'planr',
      'operate',
      'recovery',
      'storage-status',
      '--json',
    ]);
    await program().parseAsync([
      'node',
      'planr',
      'operate',
      'recovery',
      'migrate-storage',
      '--json',
    ]);

    expect(storageStatusMock).toHaveBeenCalledWith('/tmp/openplanr-cli-contract');
    expect(storageMigrationMock).toHaveBeenCalledWith('/tmp/openplanr-cli-contract');
  });
});

describe('Operate note validation CLI contract', () => {
  const validResult: OperateNoteValidationResult = {
    ok: true,
    profile: 'advisor',
    contractVersion: '2.0.0',
    contractKind: 'operate-review-quality-contract',
    versionSource: 'requested',
    byteLength: 128,
    itemCount: 1,
    diagnostics: [],
  };

  it('reads one note, passes the requested contract version, and renders a stable success envelope', async () => {
    const inspect = vi.fn().mockResolvedValue(validResult);
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const file = temporaryFile('advisor.md', '# Advisor review\n');
    try {
      await noteProgram(inspect).parseAsync([
        'node',
        'planr',
        'operate',
        'validate-note',
        file,
        '--profile',
        'advisor',
        '--contract-version',
        '2.0.0',
        '--json',
      ]);
      expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toEqual({
        ok: true,
        operation: 'operate.note.validate',
        data: {
          profile: 'advisor',
          contractVersion: '2.0.0',
          contractKind: 'operate-review-quality-contract',
          versionSource: 'requested',
          byteLength: 128,
          itemCount: 1,
        },
        diagnostics: [],
      });
    } finally {
      output.mockRestore();
    }
    expect(inspect).toHaveBeenCalledWith('# Advisor review\n', {
      profile: 'advisor',
      contractVersion: '2.0.0',
    });
    expect(process.exitCode).toBeUndefined();
  });

  it('renders bounded diagnostics and exits nonzero for an invalid note', async () => {
    const inspect = vi.fn().mockResolvedValue({
      ok: false,
      profile: 'chair',
      contractVersion: '2.0.0',
      contractKind: 'operate-review-quality-contract',
      versionSource: 'structure',
      byteLength: 64,
      itemCount: 0,
      diagnostics: [
        {
          code: 'E_OPERATE_REVIEW_SECTION_MISSING',
          message: 'Required section Decision queue is missing.',
        },
      ],
    } satisfies OperateNoteValidationResult);
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const file = temporaryFile('chair.md', '# Chair review\n');
    try {
      await noteProgram(inspect).parseAsync([
        'node',
        'planr',
        'operate',
        'validate-note',
        file,
        '--profile',
        'chair',
        '--json',
      ]);
      expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toEqual({
        ok: false,
        code: 'E_OPERATE_NOTE_INVALID',
        problem: 'The Operate chair note failed 1 contract check.',
        data: {
          profile: 'chair',
          contractVersion: '2.0.0',
          contractKind: 'operate-review-quality-contract',
          versionSource: 'structure',
          byteLength: 64,
          itemCount: 0,
        },
        diagnostics: [
          {
            code: 'E_OPERATE_REVIEW_SECTION_MISSING',
            problem: 'Required section Decision queue is missing.',
          },
        ],
      });
      expect(process.exitCode).toBe(1);
    } finally {
      output.mockRestore();
    }
  });

  it('caps public diagnostics and reports how many were omitted', async () => {
    const inspect = vi.fn().mockResolvedValue({
      ok: false,
      profile: 'board-report',
      contractVersion: '1.0.0',
      contractKind: 'operate-human-review-contract',
      versionSource: 'structure',
      byteLength: 1_024,
      itemCount: 0,
      diagnostics: Array.from({ length: 55 }, (_, index) => ({
        code: 'E_OPERATE_REVIEW_SECTION_MISSING',
        message: `Diagnostic ${index + 1}\n${'x'.repeat(600)}`,
      })),
    } satisfies OperateNoteValidationResult);
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const file = temporaryFile('board-report.md', '# Board report\n');
    try {
      await noteProgram(inspect).parseAsync([
        'node',
        'planr',
        'operate',
        'validate-note',
        file,
        '--profile',
        'board-report',
        '--json',
      ]);
      const envelope = JSON.parse(String(output.mock.calls.at(-1)?.[0]));
      expect(envelope.problem).toBe('The Operate board-report note failed 55 contract checks.');
      expect(envelope.diagnostics).toHaveLength(50);
      expect(envelope.diagnosticsOmitted).toBe(5);
      expect(envelope.diagnostics[0].problem).toHaveLength(500);
      expect(envelope.diagnostics[0].problem).not.toContain('\n');
    } finally {
      output.mockRestore();
    }
  });

  it('rejects invalid profiles before reading or inspecting the note', async () => {
    const inspect = vi.fn().mockResolvedValue(validResult);
    const file = temporaryFile('advisor.md', '# Advisor review\n');
    await expect(
      noteProgram(inspect).parseAsync([
        'node',
        'planr',
        'operate',
        'validate-note',
        file,
        '--profile',
        'unknown',
      ]),
    ).rejects.toMatchObject({ code: 'commander.invalidArgument', exitCode: 1 });
    expect(inspect).not.toHaveBeenCalled();
  });

  it('rejects unsupported contract versions before reading or inspecting the note', async () => {
    const inspect = vi.fn().mockResolvedValue(validResult);
    const file = temporaryFile('advisor.md', '# Advisor review\n');
    await expect(
      noteProgram(inspect).parseAsync([
        'node',
        'planr',
        'operate',
        'validate-note',
        file,
        '--profile',
        'advisor',
        '--contract-version',
        '3.0.0',
      ]),
    ).rejects.toMatchObject({ code: 'commander.invalidArgument', exitCode: 1 });
    expect(inspect).not.toHaveBeenCalled();
  });

  it('reports missing and invalid UTF-8 note files with stable typed failures', async () => {
    const inspect = vi.fn().mockResolvedValue(validResult);
    await expect(
      noteProgram(inspect).parseAsync([
        'node',
        'planr',
        'operate',
        'validate-note',
        path.join(tmpdir(), 'missing-operate-note.md'),
        '--profile',
        'advisor',
      ]),
    ).rejects.toMatchObject({
      code: 'E_OPERATE_NOTE_NOT_FOUND',
      message: 'The Operate note file does not exist.',
    });

    const invalidUtf8 = temporaryFile('advisor.md', Buffer.from([0x23, 0x20, 0xff]));
    await expect(
      noteProgram(inspect).parseAsync([
        'node',
        'planr',
        'operate',
        'validate-note',
        invalidUtf8,
        '--profile',
        'advisor',
      ]),
    ).rejects.toMatchObject({
      code: 'E_OPERATE_NOTE_UTF8_INVALID',
      message: 'The Operate note must be valid UTF-8 Markdown.',
    });
    expect(inspect).not.toHaveBeenCalled();
  });
});
