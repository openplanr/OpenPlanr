import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestProject, type TestProject } from '../helpers/test-project.js';

const CLI = path.resolve('src/cli/index.ts');
const TSX = createRequire(import.meta.url).resolve('tsx/cli');

const STORY = `---
id: "US-001"
title: "Link sign-in"
specId: "SPEC-001"
slug: "link-sign-in"
schemaVersion: "1.7.0"
status: "pending"
created: "2026-11-09"
updated: "2026-11-09"
acceptanceCriteria:
  - id: "AC-001"
    statement: "One link is sent"
  - id: "AC-002"
    statement: "An expired link is refused"
---

# US-001: Link sign-in
`;

function task(fields: { id?: string; storyId?: string; refs?: string[]; tests?: string } = {}) {
  const refs = fields.refs ?? ['AC-001', 'AC-002'];
  return `---
id: "${fields.id ?? 'T-001'}"
title: "Send sign-in links"
storyId: "${fields.storyId ?? 'US-001'}"
specId: "SPEC-001"
slug: "send-sign-in-links"
schemaVersion: "1.7.0"
type: "Tech"
agent: "backend-agent"
status: "pending"
created: "2026-11-09"
updated: "2026-11-09"
dependsOn: []
preserve: []
reviewRisks: []
browserSurfaces: []
acceptanceRefs: [${refs.map((ref) => `"${ref}"`).join(', ')}]
---

# Send sign-in links

## Test Requirements

${fields.tests ?? '- AC-001: an integration test sees one link sent.\n- AC-002: an expired link returns 410.'}

## Definition of Done

- Tests pass.
`;
}

const projects: TestProject[] = [];

async function project(files: Record<string, string>): Promise<TestProject> {
  const created = await createTestProject('spec-validate-plan');
  projects.push(created);
  const specs = path.join(created.dir, created.config.outputPaths.agile, 'specs');
  const all: Record<string, string> = {
    'SPEC-001-login/SPEC-001-login.md': '---\nid: "SPEC-001"\n---\n# Login\n',
    ...files,
  };
  for (const [file, content] of Object.entries(all)) {
    mkdirSync(path.dirname(path.join(specs, file)), { recursive: true });
    writeFileSync(path.join(specs, file), content);
  }
  return created;
}

const VALID = {
  'SPEC-001-login/stories/US-001-link-sign-in.md': STORY,
  'SPEC-001-login/tasks/T-001-send-sign-in-links.md': task(),
};

function run(projectDir: string, args: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [TSX, CLI, '--project-dir', projectDir, ...args], {
    cwd: projectDir,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

interface PlanJson {
  ok: boolean;
  specId: string;
  stories: number;
  tasks: number;
  violations: Array<{ file: string; rule: string; message: string }>;
}

function validate(projectDir: string): { status: number | null; report: PlanJson } {
  const result = run(projectDir, ['spec', 'validate-plan', 'SPEC-001', '--json']);
  return { status: result.status, report: JSON.parse(result.stdout) as PlanJson };
}

function rules(report: PlanJson): string[] {
  return [...new Set(report.violations.map((violation) => violation.rule))].sort();
}

afterEach(() => {
  for (const created of projects.splice(0)) created.cleanup();
});

describe('openplanr spec validate-plan', { timeout: 60_000 }, () => {
  it('accepts a covered plan and writes nothing', async () => {
    const created = await project(VALID);
    const taskPath = path.join(
      created.dir,
      created.config.outputPaths.agile,
      'specs/SPEC-001-login/tasks/T-001-send-sign-in-links.md',
    );
    const before = readFileSync(taskPath);
    const result = run(created.dir, ['spec', 'validate-plan', 'SPEC-001']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('SPEC-001 plan is valid: 1 story, 1 task.');

    const { status, report } = validate(created.dir);
    expect(status).toBe(0);
    expect(report).toMatchObject({ ok: true, specId: 'SPEC-001', stories: 1, tasks: 1 });
    expect(report.violations).toEqual([]);
    expect(readFileSync(taskPath).equals(before)).toBe(true);
  });

  it('rejects a criterion no task maps through acceptanceRefs', async () => {
    const created = await project({
      ...VALID,
      'SPEC-001-login/tasks/T-001-send-sign-in-links.md': task({
        refs: ['AC-001'],
        tests: '- AC-001: one link is sent.',
      }),
    });
    const { status, report } = validate(created.dir);
    expect(status).toBe(1);
    expect(rules(report)).toEqual(['coverage']);
    expect(report.violations[0].message).toContain('AC-002');
  });

  it('rejects a mapped criterion missing from Test Requirements', async () => {
    const created = await project({
      ...VALID,
      'SPEC-001-login/tasks/T-001-send-sign-in-links.md': task({
        tests: '- AC-001: one link is sent.',
      }),
    });
    const { status, report } = validate(created.dir);
    expect(status).toBe(1);
    expect(rules(report)).toEqual(['verification']);
    expect(report.violations[0].message).toContain('AC-002');
  });

  it('rejects a task reference the story does not declare', async () => {
    const created = await project({
      ...VALID,
      'SPEC-001-login/tasks/T-001-send-sign-in-links.md': task({
        refs: ['AC-001', 'AC-002', 'AC-009'],
      }),
    });
    const { report } = validate(created.dir);
    expect(rules(report)).toEqual(['reference']);
    expect(report.violations[0].message).toContain('AC-009');
  });

  it('rejects a task whose story is not in the spec', async () => {
    const created = await project({
      ...VALID,
      'SPEC-001-login/tasks/T-002-orphan.md': task({ id: 'T-002', storyId: 'US-404' }),
    });
    const { report } = validate(created.dir);
    expect(rules(report)).toEqual(['reference']);
    expect(report.violations[0].message).toContain('US-404');
  });

  it('rejects invalid and unparsable frontmatter', async () => {
    const created = await project({
      'SPEC-001-login/stories/US-001-link-sign-in.md': STORY.replace('status: "pending"', ''),
      'SPEC-001-login/tasks/T-001-send-sign-in-links.md': '---\nid: [unclosed\n---\n',
    });
    const { status, report } = validate(created.dir);
    expect(status).toBe(1);
    const frontmatter = report.violations.filter((violation) => violation.rule === 'frontmatter');
    expect(frontmatter.some((violation) => violation.file.endsWith('US-001-link-sign-in.md'))).toBe(
      true,
    );
    expect(
      frontmatter.some(
        (violation) =>
          violation.file.endsWith('T-001-send-sign-in-links.md') &&
          violation.message.includes('not valid YAML'),
      ),
    ).toBe(true);
  });

  it('rejects an id repeated anywhere in the project', async () => {
    const created = await project({
      ...VALID,
      'SPEC-002-other/SPEC-002-other.md': '---\nid: "SPEC-002"\n---\n# Other\n',
      'SPEC-002-other/tasks/T-001-elsewhere.md': task().replaceAll('SPEC-001', 'SPEC-002'),
    });
    const { status, report } = validate(created.dir);
    expect(status).toBe(1);
    expect(rules(report)).toEqual(['duplicate-id']);
    expect(report.violations[0].message).toContain('T-001');
    expect(report.violations[0].message).toContain('T-001-elsewhere.md');
  });

  it('rejects a filename id that disagrees with the frontmatter id', async () => {
    const created = await project({
      ...VALID,
      'SPEC-001-login/tasks/T-001-send-sign-in-links.md': task({ id: 'T-007' }),
    });
    const { report } = validate(created.dir);
    expect(rules(report)).toEqual(['id-mismatch']);
  });

  it('rejects a spec with no stories', async () => {
    const created = await project({});
    const { status, report } = validate(created.dir);
    expect(status).toBe(1);
    expect(rules(report)).toEqual(['empty']);
  });

  it('fails with E_SPEC_NOT_FOUND for an unknown spec', async () => {
    const created = await project(VALID);
    const result = run(created.dir, ['spec', 'validate-plan', 'SPEC-404', '--json']);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ code: 'E_SPEC_NOT_FOUND' });
  });
});
