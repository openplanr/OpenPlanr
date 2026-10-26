import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createSpecStory,
  createSpecTask,
  SPEC_CONTRACT_HEADINGS,
} from '../../src/services/spec-service.js';
import { createTestProject, type TestProject } from '../helpers/test-project.js';

const CLI = path.resolve('src/cli/index.ts');
const TSX = createRequire(import.meta.url).resolve('tsx/cli');
const CONTRACT = path.resolve('../../skills/planr-spec/references/specification-contract.md');

const FRONTMATTER = [
  '---',
  'id: "SPEC-001"',
  'title: "Login"',
  'slug: "login"',
  'schemaVersion: "1.7.0"',
  'status: "shaped"',
  'priority: "P1"',
  'created: "2026-10-26"',
  'updated: "2026-10-26"',
  'ui_files: []',
  'tech_dependencies: []',
  '---',
].join('\n');

const BODY = `
# SPEC-001: Login

## Context & Goal

Users sign in with an email link so they can reach their saved work.

## Audience

**Primary:** Returning users.

## Outcome & Measurement

**Statement:** Returning users reach their work without a password.

## Functional Requirements

- The system must send a single-use sign-in link.

## Business Rules

- A link expires after fifteen minutes.

## Constraints

- No new runtime dependency.

## Evidence Expectations

- An integration test signs in through the link.

## Failure Modes

- Mail delivery fails; the page offers a resend.

## Rollback

Disable the link route and restore password sign-in.

## Scope Boundaries

### In Scope

- Email link sign-in.

### Out of Scope

- Social sign-in.

## Acceptance Criteria

- [ ] AC-001: Given a known email, when the user requests a link, then one link is sent.
- [ ] AC-002: Given an expired link, when it is opened, then sign-in is refused.

## Declared Risk Specialists

- security

## Notes for Decomposition

- One backend task.
`;

const VALID = `${FRONTMATTER}\n${BODY}`;
const projects: TestProject[] = [];

async function project(content = VALID): Promise<{ created: TestProject; specPath: string }> {
  const created = await createTestProject('spec-validate');
  projects.push(created);
  const dir = path.join(created.dir, created.config.outputPaths.agile, 'specs', 'SPEC-001-login');
  mkdirSync(dir, { recursive: true });
  const specPath = path.join(dir, 'SPEC-001-login.md');
  writeFileSync(specPath, content);
  return { created, specPath };
}

async function decomposed(created: TestProject): Promise<void> {
  const story = await createSpecStory(created.dir, created.config, 'SPEC-001', 'Link sign-in', {
    roleAction: 'a returning user, I want an email link',
    benefit: 'I reach my work without a password',
    acceptanceCriteria: [{ id: 'AC-001', statement: 'One link is sent' }],
    tasks: [],
  });
  await createSpecTask(created.dir, created.config, 'SPEC-001', {
    storyId: story.id,
    title: 'Send sign-in links',
    type: 'Tech',
    agent: 'backend-agent',
    acceptanceRefs: ['AC-001'],
    reviewRisks: [],
    browserSurfaces: [],
  });
}

function run(projectDir: string, args: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [TSX, CLI, '--project-dir', projectDir, ...args], {
    cwd: projectDir,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

interface ValidateJson {
  ok: boolean;
  specId: string;
  file: string | null;
  violations: Array<{ file: string; rule: string; message: string }>;
}

function validateJson(projectDir: string): { status: number | null; report: ValidateJson } {
  const result = run(projectDir, ['spec', 'validate', 'SPEC-001', '--json']);
  return { status: result.status, report: JSON.parse(result.stdout) as ValidateJson };
}

afterEach(() => {
  for (const created of projects.splice(0)) created.cleanup();
});

describe('openplanr spec validate', { timeout: 60_000 }, () => {
  it('accepts a spec that meets the contract and leaves the file untouched', async () => {
    const { created, specPath } = await project();
    const before = readFileSync(specPath);
    const result = run(created.dir, ['spec', 'validate', 'SPEC-001']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('SPEC-001 meets the specification contract.');
    expect(readFileSync(specPath).equals(before)).toBe(true);

    const json = validateJson(created.dir);
    expect(json.status).toBe(0);
    expect(json.report).toMatchObject({ ok: true, specId: 'SPEC-001', violations: [] });
  });

  it('rejects a garbage file', async () => {
    const { created, specPath } = await project('asdf qwer\n!!@@ not a spec\n');
    const before = readFileSync(specPath);
    const { status, report } = validateJson(created.dir);
    expect(status).toBe(1);
    expect(report.ok).toBe(false);
    const rules = new Set(report.violations.map((violation) => violation.rule));
    expect([...rules].sort()).toEqual(['acceptance-ids', 'frontmatter', 'headings']);
    expect(report.violations.every((violation) => violation.file === specPath)).toBe(true);
    expect(readFileSync(specPath).equals(before)).toBe(true);
  });

  it('rejects a spec without an id', async () => {
    const { created, specPath } = await project(VALID.replace('id: "SPEC-001"\n', ''));
    const before = readFileSync(specPath);
    const result = run(created.dir, ['spec', 'validate', 'SPEC-001']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${specPath}: [frontmatter]`);
    expect(result.stderr).toContain('id');
    expect(readFileSync(specPath).equals(before)).toBe(true);
  });

  it('rejects a spec with no headings', async () => {
    const stripped = `${FRONTMATTER}\n${BODY.replace(/^#+ .*$/gmu, '')}`;
    const { created, specPath } = await project(stripped);
    const before = readFileSync(specPath);
    const { status, report } = validateJson(created.dir);
    expect(status).toBe(1);
    const headings = report.violations.filter((violation) => violation.rule === 'headings');
    expect(headings).toHaveLength(SPEC_CONTRACT_HEADINGS.length);
    expect(readFileSync(specPath).equals(before)).toBe(true);
  });

  it('rejects a wrong schemaVersion as an error', async () => {
    const { created, specPath } = await project(
      VALID.replace('schemaVersion: "1.7.0"', 'schemaVersion: "1.0.0"'),
    );
    const before = readFileSync(specPath);
    const { status, report } = validateJson(created.dir);
    expect(status).toBe(1);
    expect(report.violations).toEqual([
      expect.objectContaining({
        rule: 'frontmatter',
        message: expect.stringMatching(/schemaVersion/u),
      }),
    ]);
    expect(readFileSync(specPath).equals(before)).toBe(true);
  });

  it('rejects headings out of order and acceptance criteria without stable ids', async () => {
    const swapped = VALID.replace('## Business Rules', '## Placeholder')
      .replace('## Constraints', '## Business Rules')
      .replace('## Placeholder', '## Constraints')
      .replace('- [ ] AC-002:', '- [ ] AC-2:');
    const { created } = await project(swapped);
    const { status, report } = validateJson(created.dir);
    expect(status).toBe(1);
    expect(report.violations.map((violation) => violation.rule).sort()).toEqual([
      'acceptance-ids',
      'headings',
    ]);
  });

  it('rejects a spec file whose frontmatter does not match its path', async () => {
    const { created } = await project(VALID.replace('slug: "login"', 'slug: "sign-in"'));
    const { status, report } = validateJson(created.dir);
    expect(status).toBe(1);
    expect(report.violations).toEqual([expect.objectContaining({ rule: 'path' })]);
  });

  it('keeps its heading list in step with the specification contract', () => {
    const listed = [...readFileSync(CONTRACT, 'utf8').matchAll(/^\d+\. `## ([^`]+)`/gmu)].map(
      (match) => match[1],
    );
    expect(listed).toEqual([...SPEC_CONTRACT_HEADINGS]);
  });
});

describe('openplanr spec promote', { timeout: 60_000 }, () => {
  it('--dry-run validates and prints the handoff without writing', async () => {
    const { created, specPath } = await project();
    await decomposed(created);
    const before = readFileSync(specPath);
    const result = run(created.dir, ['spec', 'promote', 'SPEC-001', '--dry-run']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('$planr:plan SPEC-001');
    expect(result.stdout).toContain('Dry run');
    expect(readFileSync(specPath).equals(before)).toBe(true);
  });

  it('marks the spec ready-for-pipeline by default', async () => {
    const { created, specPath } = await project();
    await decomposed(created);
    const result = run(created.dir, ['spec', 'promote', 'SPEC-001']);
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(specPath, 'utf8')).toContain('status: "ready-for-pipeline"');
  });

  it('says in its help that it marks the spec ready-for-pipeline', () => {
    const result = run(process.cwd(), ['spec', 'promote', '--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/marks? the spec\s+ready-for-pipeline/u);
    expect(result.stdout).toContain('--dry-run');
  });
});
