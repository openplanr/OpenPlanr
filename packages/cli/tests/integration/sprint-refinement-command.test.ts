import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  registerBacklogCommand,
  registerQuickCommand,
  registerSprintCommand,
} from '../../src/cli/commands/planning-artifacts.js';
import { readArtifact } from '../../src/services/artifact-service.js';
import { readGraph } from '../../src/services/graph-service.js';
import { createTestProject, type TestProject } from '../helpers/test-project.js';

const execFileAsync = promisify(execFile);
const projects: TestProject[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const project of projects.splice(0)) project.cleanup();
});

function program(projectDir: string): Command {
  const cli = new Command();
  cli.exitOverride();
  cli.option('--project-dir <path>', 'project directory', projectDir);
  cli.option('-y, --yes', 'auto-accept all prompts');
  registerBacklogCommand(cli);
  registerQuickCommand(cli);
  registerSprintCommand(cli);
  return cli;
}

async function run(projectDir: string, ...args: string[]): Promise<Record<string, unknown>[]> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
  try {
    await program(projectDir).parseAsync(['node', 'planr', ...args]);
  } finally {
    spy.mockRestore();
  }
  return lines.filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

async function seed(): Promise<TestProject> {
  const project = await createTestProject('sprint-refinement');
  projects.push(project);
  await run(project.dir, 'backlog', 'add', 'CRM callback silent', '--json');
  await run(project.dir, 'backlog', 'add', 'Dead item from May', '--json');
  await run(project.dir, 'backlog', 'add', 'Austrian Matura mapping', '--json');
  await run(project.dir, 'quick', 'create', 'Release cut 25 Sep', '--json');
  return project;
}

function refinement(sprintId: string, refinedAt = '2026-09-17') {
  return {
    schemaVersion: 1,
    sprintId,
    refinedAt,
    inputs: { capacityDays: 6, releaseCut: '2026-09-25', sources: ['backlog', 'quick'] },
    items: [
      {
        id: 'BL-001',
        title: 'CRM callback silent',
        evidenceDate: '2026-09-10',
        effort: 'hours',
        score: 9,
        bucket: 'inProgress',
        reason: '39 applications stuck',
      },
      {
        id: 'QT-001',
        title: 'Release cut 25 Sep',
        effort: 'hours',
        score: 7,
        bucket: 'inProgress',
        reason: 'the cut itself is work',
      },
      {
        id: 'BL-002',
        title: 'Dead item from May',
        evidenceDate: '2026-05-01',
        stale: true,
        effort: 'days',
        score: 1,
        bucket: 'closeOrDemote',
        reason: 'delivered by #569',
        evidence: 'PR #569',
        targetStatus: 'closed',
      },
      {
        id: 'BL-003',
        title: 'Austrian Matura mapping',
        effort: 'day',
        score: 4,
        bucket: 'blocked',
        reason: 'needs the partner mapping',
        blockedBy: ['partner: Dynamics team'],
        unblockQuestion: 'Which Dynamics id is the Austrian Matura?',
      },
    ],
    buckets: {
      inProgress: ['BL-001', 'QT-001'],
      planNext: [],
      blocked: ['BL-003'],
      closeOrDemote: ['BL-002'],
    },
    batches: [
      { title: 'VM read session', effortDays: 0.5, itemIds: ['BL-001'] },
      { title: 'PR 1 · the cut', effortDays: 0.5, itemIds: ['QT-001'] },
    ],
    refuted: [
      {
        itemId: 'BL-002',
        lens: 'evidence',
        change: 'delivered on 8 Sep, moved to close',
        from: 'inProgress',
        to: 'closeOrDemote',
      },
    ],
  };
}

async function writeJson(dir: string, name: string, value: unknown): Promise<string> {
  const file = path.join(dir, name);
  await writeFile(file, JSON.stringify(value));
  return file;
}

describe('planr sprint refinement lifecycle', () => {
  it('creates a sprint with the cut and capacity, then fills it from the refinement document', async () => {
    const project = await seed();
    const sprintInput = await writeJson(project.dir, 'sprint.json', {
      title: 'Cut 25 Sep 2026',
      releaseCut: '2026-09-25',
      capacityDays: 6,
      startDate: '2026-09-17',
    });
    const [created] = await run(project.dir, 'sprint', 'create', '--data', sprintInput, '--json');
    expect(created).toMatchObject({ ok: true, action: 'sprint.created', id: 'SPRINT-001' });

    const sprint = await readArtifact(project.dir, project.config, 'sprint', 'SPRINT-001');
    expect(sprint?.data).toMatchObject({
      releaseCut: '2026-09-25',
      capacityDays: 6,
      endDate: '2026-09-25',
      duration: '8d',
      status: 'active',
      taskIds: [],
    });

    const doc = await writeJson(project.dir, 'refinement.json', refinement('SPRINT-001'));
    const [refined] = await run(
      project.dir,
      'sprint',
      'refinement',
      'SPRINT-001',
      '--data',
      doc,
      '--json',
    );
    expect(refined).toMatchObject({
      ok: true,
      action: 'sprint.refined',
      id: 'SPRINT-001',
      refinementPath: '.planr/sprints/SPRINT-001/refinement.json',
      notePath: '.planr/sprints/SPRINT-001/refinement.md',
      counts: { inProgress: 2, planNext: 0, blocked: 1, closeOrDemote: 1, refuted: 1 },
    });

    const filled = await readArtifact(project.dir, project.config, 'sprint', 'SPRINT-001');
    expect(filled?.data).toMatchObject({
      taskIds: ['BL-001', 'QT-001'],
      refinedAt: '2026-09-17',
      capacityDays: 6,
      releaseCut: '2026-09-25',
    });
    expect(filled?.content).toContain('### VM read session · 0.5d');
    expect(filled?.content).toContain(
      '- [ ] **BL-001** CRM callback silent · hours · [view](../backlog/BL-001-crm-callback-silent.md)',
    );
    expect(filled?.content).toContain(
      '- [ ] **QT-001** Release cut 25 Sep · hours · [view](../quick/QT-001-release-cut-25-sep.md)',
    );
    expect(filled?.content).toContain('## Retrospective');

    const note = await readFile(
      path.join(project.dir, '.planr/sprints/SPRINT-001/refinement.md'),
      'utf8',
    );
    expect(note).toContain('| BL-002 | 1 | 2026-05-01 | yes | — | days | closeOrDemote |');
    expect(note).toContain('- **BL-002** · evidence · delivered on 8 Sep, moved to close');
    expect(note).toContain(
      '- **BL-003** Austrian Matura mapping · day · needs the partner mapping · blocked by partner: Dynamics team · unblock: Which Dynamics id is the Austrian Matura?',
    );
    expect(note).not.toContain('\n\n\n');

    const stored = JSON.parse(
      await readFile(path.join(project.dir, '.planr/sprints/SPRINT-001/refinement.json'), 'utf8'),
    );
    expect(stored.buckets.inProgress).toEqual(['BL-001', 'QT-001']);

    const graphIds = readGraph(path.join(project.dir, '.planr')).nodes.map((node) => node.id);
    expect(graphIds).toContain('SPRINT-001');
    expect(graphIds).not.toContain('refinement');
  });

  it('keeps checked items checked when the refinement is recorded again', async () => {
    const project = await seed();
    await run(project.dir, 'sprint', 'create', 'Sprint', '--json');
    const doc = await writeJson(project.dir, 'refinement.json', refinement('SPRINT-001'));
    await run(project.dir, 'sprint', 'refinement', 'SPRINT-001', '--data', doc, '--json');
    const before = await readArtifact(project.dir, project.config, 'sprint', 'SPRINT-001');
    const file = before?.filePath as string;
    await writeFile(
      file,
      (await readFile(file, 'utf8')).replace('- [ ] **BL-001**', '- [x] **BL-001**'),
    );

    await run(project.dir, 'sprint', 'refinement', 'SPRINT-001', '--data', doc, '--json');
    const after = await readArtifact(project.dir, project.config, 'sprint', 'SPRINT-001');
    expect(after?.content).toContain('- [x] **BL-001**');
    expect(after?.content).toContain('- [ ] **QT-001**');
  });

  it('applies the write-back only with confirmation and commits exactly the touched files', async () => {
    const project = await seed();
    await git(project.dir, 'init', '-q');
    await git(project.dir, 'config', 'user.email', 'test@example.com');
    await git(project.dir, 'config', 'user.name', 'Test User');
    await git(project.dir, 'config', 'commit.gpgsign', 'false');
    await run(project.dir, 'sprint', 'create', 'Cut 25 Sep', '--json');
    const doc = await writeJson(project.dir, 'refinement.json', refinement('SPRINT-001'));
    await run(project.dir, 'sprint', 'refinement', 'SPRINT-001', '--data', doc, '--json');
    await writeFile(path.join(project.dir, 'unrelated.txt'), 'staged but not ours');
    await git(project.dir, 'add', '-A');
    await git(project.dir, 'commit', '-q', '-m', 'seed');
    await writeFile(path.join(project.dir, 'unrelated.txt'), 'changed after seed');
    await git(project.dir, 'add', 'unrelated.txt');

    await expect(run(project.dir, 'sprint', 'apply', 'SPRINT-001', '--json')).rejects.toMatchObject(
      {
        code: 'E_SPRINT_APPLY_CONFIRMATION_REQUIRED',
      },
    );

    const [dry] = await run(project.dir, 'sprint', 'apply', 'SPRINT-001', '--dry-run', '--json');
    expect(dry).toMatchObject({ ok: true, action: 'sprint.applied', dryRun: true });
    expect((dry.updates as unknown[]).length).toBe(2);
    const untouched = await readArtifact(project.dir, project.config, 'backlog', 'BL-002');
    expect(untouched?.data.status).toBe('open');

    const [applied] = await run(
      project.dir,
      'sprint',
      'apply',
      'SPRINT-001',
      '--yes',
      '--commit',
      '--json',
    );
    expect(applied).toMatchObject({
      ok: true,
      dryRun: false,
      message: 'chore(planr): refine backlog for SPRINT-001',
      updates: [
        { id: 'BL-002', type: 'backlog', fields: { status: 'closed' }, from: { status: 'open' } },
        { id: 'BL-003', type: 'backlog', fields: { blockedBy: 'partner: Dynamics team' } },
      ],
      commit: { committed: true },
    });

    const closed = await readArtifact(project.dir, project.config, 'backlog', 'BL-002');
    expect(closed?.data.status).toBe('closed');
    const blocked = await readArtifact(project.dir, project.config, 'backlog', 'BL-003');
    expect(blocked?.data).toMatchObject({ blockedBy: 'partner: Dynamics team' });

    expect(await git(project.dir, 'log', '--format=%s', '-1')).toBe(
      'chore(planr): refine backlog for SPRINT-001',
    );
    const committed = (await git(project.dir, 'show', '--name-only', '--format=', 'HEAD')).split(
      '\n',
    );
    expect(committed.sort()).toEqual(
      [
        '.planr/backlog/BL-002-dead-item-from-may.md',
        '.planr/backlog/BL-003-austrian-matura-mapping.md',
        '.planr/sprints/SPRINT-001/refinement.json',
        '.planr/sprints/SPRINT-001/refinement.md',
      ].sort(),
    );
    expect(await git(project.dir, 'status', '--porcelain')).toBe('M  unrelated.txt');

    const stored = JSON.parse(
      await readFile(path.join(project.dir, '.planr/sprints/SPRINT-001/refinement.json'), 'utf8'),
    );
    expect(stored.applied.updates.map((u: { id: string }) => u.id)).toEqual(['BL-002', 'BL-003']);
  });

  it('refuses target statuses outside the repository vocabulary unless forced', async () => {
    const project = await seed();
    await run(project.dir, 'sprint', 'create', 'Sprint', '--json');
    const doc = refinement('SPRINT-001');
    doc.items[2].targetStatus = 'archived';
    const file = await writeJson(project.dir, 'refinement.json', doc);
    await run(project.dir, 'sprint', 'refinement', 'SPRINT-001', '--data', file, '--json');

    await expect(
      run(project.dir, 'sprint', 'apply', 'SPRINT-001', '--yes', '--json'),
    ).rejects.toMatchObject({
      code: 'E_SPRINT_APPLY_STATUS_INVALID',
      details: { diagnostics: [{ path: '$.items[2].targetStatus' }] },
    });
    await run(project.dir, 'sprint', 'apply', 'SPRINT-001', '--yes', '--force', '--json');
    const forced = await readArtifact(project.dir, project.config, 'backlog', 'BL-002');
    expect(forced?.data.status).toBe('archived');
  });

  it('closes the sprint with its leftovers and diffs two refinement runs', async () => {
    const project = await seed();
    await run(project.dir, 'sprint', 'create', 'First', '--json');
    const first = await writeJson(project.dir, 'first.json', refinement('SPRINT-001'));
    await run(project.dir, 'sprint', 'refinement', 'SPRINT-001', '--data', first, '--json');
    const sprint = await readArtifact(project.dir, project.config, 'sprint', 'SPRINT-001');
    const file = sprint?.filePath as string;
    await writeFile(
      file,
      (await readFile(file, 'utf8')).replace('- [ ] **QT-001**', '- [x] **QT-001**'),
    );

    const [closed] = await run(project.dir, 'sprint', 'close', 'SPRINT-001', '--json');
    expect(closed).toMatchObject({
      ok: true,
      action: 'sprint.closed',
      leftovers: [{ id: 'BL-001', reason: 'unchecked' }],
    });
    const reread = await readArtifact(project.dir, project.config, 'sprint', 'SPRINT-001');
    expect(reread?.data).toMatchObject({
      status: 'closed',
      closedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u),
    });
    await expect(run(project.dir, 'sprint', 'close', 'SPRINT-001', '--json')).rejects.toMatchObject(
      { code: 'E_SPRINT_ALREADY_CLOSED' },
    );
    await expect(
      run(project.dir, 'sprint', 'refinement', 'SPRINT-001', '--data', first, '--json'),
    ).rejects.toMatchObject({ code: 'E_SPRINT_CLOSED' });

    await run(project.dir, 'sprint', 'create', 'Second', '--json');
    const next = refinement('SPRINT-002', '2026-10-01');
    next.items[0].bucket = 'planNext';
    next.items[0].score = 3;
    next.buckets = {
      inProgress: ['QT-001'],
      planNext: ['BL-001'],
      blocked: ['BL-003'],
      closeOrDemote: ['BL-002'],
    };
    next.batches = [{ title: 'PR 1 · the cut', itemIds: ['QT-001'] }];
    const second = await writeJson(project.dir, 'second.json', next);
    await run(project.dir, 'sprint', 'refinement', 'SPRINT-002', '--data', second, '--json');

    const [diff] = await run(project.dir, 'sprint', 'diff', 'SPRINT-001', 'SPRINT-002', '--json');
    expect(diff).toMatchObject({
      ok: true,
      action: 'sprint.diffed',
      moved: [{ id: 'BL-001', from: 'inProgress', to: 'planNext', scoreFrom: 9, scoreTo: 3 }],
      added: [],
      removed: [],
      unchanged: 3,
    });
    await expect(
      run(project.dir, 'sprint', 'diff', 'SPRINT-001', 'SPRINT-009', '--json'),
    ).rejects.toMatchObject({ code: 'E_SPRINT_REFINEMENT_MISSING' });
  });

  it('rejects an inconsistent document with $-rooted diagnostics and leaves the sprint untouched', async () => {
    const project = await seed();
    await run(project.dir, 'sprint', 'create', 'Sprint', '--json');
    const doc = refinement('SPRINT-001');
    doc.buckets.inProgress = ['BL-001'];
    const file = await writeJson(project.dir, 'bad.json', doc);
    await expect(
      run(project.dir, 'sprint', 'refinement', 'SPRINT-001', '--data', file, '--json'),
    ).rejects.toMatchObject({
      code: 'E_SPRINT_REFINEMENT_INVALID',
      details: {
        diagnostics: expect.arrayContaining([
          {
            path: '$.items[1].bucket',
            rule: 'refinement:bucket-missing',
            detail: expect.any(String),
          },
        ]),
      },
    });
    const sprint = await readArtifact(project.dir, project.config, 'sprint', 'SPRINT-001');
    expect(sprint?.data.taskIds).toEqual([]);
  });
});
