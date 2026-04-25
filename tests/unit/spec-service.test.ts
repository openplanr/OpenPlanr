/**
 * Tests for spec-service — directory-aware CRUD for spec-driven planning mode.
 *
 * Uses a real temporary directory rather than mocks because spec-service
 * operates on real directory structures (mkdir, copyFile, recursive rm)
 * that are clumsy to mock fully. Each test gets its own tmpdir, populated
 * just-in-time, then cleaned up.
 */

import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OpenPlanrConfig } from '../../src/models/types.js';
import {
  attachSpecDesigns,
  createSpec,
  createSpecStory,
  createSpecTask,
  decomposeSpec,
  destroySpec,
  getSpecDir,
  getSpecStatus,
  getSpecsRootDir,
  listSpecStories,
  listSpecs,
  listSpecTasks,
  readSpec,
  resolveSpecDir,
  shapeSpec,
  validateSpecForPromotion,
} from '../../src/services/spec-service.js';

// Test fixture: minimal valid OpenPlanrConfig.
function makeConfig(projectDir: string): OpenPlanrConfig {
  return {
    projectName: 'test-project',
    targets: ['claude'],
    outputPaths: {
      agile: '.planr',
      cursorRules: '.cursor/rules',
      claudeConfig: '.',
      codexConfig: '.',
    },
    idPrefix: {
      epic: 'EPIC',
      feature: 'FEAT',
      story: 'US',
      task: 'TASK',
      quick: 'QT',
      backlog: 'BL',
      sprint: 'SPRINT',
      spec: 'SPEC',
    },
    createdAt: '2026-04-25',
  };
}

let projectDir: string;
let config: OpenPlanrConfig;

beforeEach(async () => {
  projectDir = await fs.mkdtemp(path.join(tmpdir(), 'planr-spec-test-'));
  config = makeConfig(projectDir);
  await fs.mkdir(path.join(projectDir, '.planr'), { recursive: true });
});

afterEach(async () => {
  if (projectDir && existsSync(projectDir)) {
    await fs.rm(projectDir, { recursive: true, force: true });
  }
});

describe('createSpec', () => {
  it('creates SPEC-001 with self-contained directory layout', async () => {
    const result = await createSpec(projectDir, config, 'User Authentication');

    expect(result.id).toBe('SPEC-001');
    expect(result.slug).toBe('user-authentication');

    const expectedDir = path.join(projectDir, '.planr/specs/SPEC-001-user-authentication');
    expect(result.specDir).toBe(expectedDir);

    // Directory + subdirectories exist
    expect(existsSync(expectedDir)).toBe(true);
    expect(existsSync(path.join(expectedDir, 'design'))).toBe(true);
    expect(existsSync(path.join(expectedDir, 'stories'))).toBe(true);
    expect(existsSync(path.join(expectedDir, 'tasks'))).toBe(true);

    // Spec file written
    const specFile = path.join(expectedDir, 'SPEC-001-user-authentication.md');
    expect(existsSync(specFile)).toBe(true);
    const content = await fs.readFile(specFile, 'utf-8');
    expect(content).toContain('id: "SPEC-001"');
    expect(content).toContain('title: "User Authentication"');
    expect(content).toContain('schemaVersion: "1.0.0"');
    expect(content).toContain('# SPEC-001: User Authentication');
  });

  it('assigns sequential IDs across multiple specs', async () => {
    const a = await createSpec(projectDir, config, 'Auth Flow');
    const b = await createSpec(projectDir, config, 'Checkout');
    expect(a.id).toBe('SPEC-001');
    expect(b.id).toBe('SPEC-002');
  });

  it('respects --slug override', async () => {
    const result = await createSpec(projectDir, config, 'User Authentication Flow', {
      slug: 'auth',
    });
    expect(result.slug).toBe('auth');
    expect(result.specDir.endsWith('SPEC-001-auth')).toBe(true);
  });

  it('refuses to overwrite an existing spec directory', async () => {
    await createSpec(projectDir, config, 'Auth', { slug: 'auth' });
    // Manually pre-create SPEC-002-auth to force collision
    await fs.mkdir(path.join(projectDir, '.planr/specs/SPEC-002-auth'), { recursive: true });
    await expect(createSpec(projectDir, config, 'Auth Again', { slug: 'auth' })).rejects.toThrow(
      /already exists/,
    );
  });

  it('writes priority and milestone into frontmatter', async () => {
    const { specFile } = await createSpec(projectDir, config, 'Auth', {
      priority: 'P0',
      milestone: 'v1.0',
      po: '@AsemDevs',
    });
    const content = await fs.readFile(specFile, 'utf-8');
    expect(content).toContain('priority: "P0"');
    expect(content).toContain('milestone: "v1.0"');
    expect(content).toContain('po: "@AsemDevs"');
  });
});

describe('listSpecs', () => {
  it('returns empty array when no specs exist', async () => {
    const result = await listSpecs(projectDir, config);
    expect(result).toEqual([]);
  });

  it('lists every spec with title, status, and counts', async () => {
    await createSpec(projectDir, config, 'Auth');
    await createSpec(projectDir, config, 'Checkout');

    const result = await listSpecs(projectDir, config);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('SPEC-001');
    expect(result[0].title).toBe('Auth');
    expect(result[0].status).toBe('pending');
    expect(result[0].storyCount).toBe(0);
    expect(result[0].taskCount).toBe(0);
    expect(result[1].id).toBe('SPEC-002');
    expect(result[1].title).toBe('Checkout');
  });

  it('sorts by ID', async () => {
    // Create out of order by manually manipulating
    await createSpec(projectDir, config, 'Checkout');
    await createSpec(projectDir, config, 'Auth');
    const result = await listSpecs(projectDir, config);
    expect(result.map((s) => s.id)).toEqual(['SPEC-001', 'SPEC-002']);
  });
});

describe('readSpec', () => {
  it('returns null for unknown spec ID', async () => {
    const result = await readSpec(projectDir, config, 'SPEC-999');
    expect(result).toBeNull();
  });

  it('reads frontmatter and body of an existing spec', async () => {
    await createSpec(projectDir, config, 'Auth Flow');
    const result = await readSpec(projectDir, config, 'SPEC-001');
    expect(result).not.toBeNull();
    expect(result?.id).toBe('SPEC-001');
    expect(result?.slug).toBe('auth-flow');
    expect(result?.data.title).toBe('Auth Flow');
    expect(result?.data.status).toBe('pending');
    expect(result?.content).toContain('Context & Goal');
  });
});

describe('resolveSpecDir', () => {
  it('resolves SPEC-001 → its on-disk directory', async () => {
    const created = await createSpec(projectDir, config, 'Auth');
    const resolved = await resolveSpecDir(projectDir, config, 'SPEC-001');
    expect(resolved).not.toBeNull();
    expect(resolved?.dir).toBe(created.specDir);
    expect(resolved?.slug).toBe('auth');
  });

  it('returns null for unknown ID', async () => {
    const resolved = await resolveSpecDir(projectDir, config, 'SPEC-999');
    expect(resolved).toBeNull();
  });

  it('handles SPEC- prefix collision safely (does not match SPEC-0011 when looking for SPEC-001)', async () => {
    // Create SPEC-001-real and a fake SPEC-0011 (which shouldn't match)
    await createSpec(projectDir, config, 'Real');
    await fs.mkdir(path.join(projectDir, '.planr/specs/SPEC-0011-fake'), { recursive: true });
    const resolved = await resolveSpecDir(projectDir, config, 'SPEC-001');
    expect(resolved?.slug).toBe('real');
  });
});

describe('createSpecStory', () => {
  it("writes a US-NNN file inside the spec's stories/ subdirectory", async () => {
    await createSpec(projectDir, config, 'Auth');
    const result = await createSpecStory(projectDir, config, 'SPEC-001', 'Login Form', {
      roleAction: 'a registered user, I want to log in',
      benefit: 'I can access my account',
    });
    expect(result.id).toBe('US-001');
    expect(result.slug).toBe('login-form');
    expect(existsSync(result.filePath)).toBe(true);

    const content = await fs.readFile(result.filePath, 'utf-8');
    expect(content).toContain('id: "US-001"');
    expect(content).toContain('specId: "SPEC-001"');
    expect(content).toContain('a registered user, I want to log in');
    expect(content).toContain('I can access my account');
  });

  it('scopes US IDs per spec — two specs each get their own US-001', async () => {
    await createSpec(projectDir, config, 'Auth');
    await createSpec(projectDir, config, 'Checkout');

    const a = await createSpecStory(projectDir, config, 'SPEC-001', 'Login', {
      roleAction: 'user',
      benefit: 'reason',
    });
    const b = await createSpecStory(projectDir, config, 'SPEC-002', 'Cart', {
      roleAction: 'user',
      benefit: 'reason',
    });

    expect(a.id).toBe('US-001');
    expect(b.id).toBe('US-001'); // Each spec has its own US-001
    expect(a.filePath).not.toBe(b.filePath);
  });
});

describe('createSpecTask', () => {
  it('writes a T-NNN file with file lists in frontmatter and body', async () => {
    await createSpec(projectDir, config, 'Auth');
    await createSpecStory(projectDir, config, 'SPEC-001', 'Login', {
      roleAction: 'user',
      benefit: 'reason',
    });

    const result = await createSpecTask(projectDir, config, 'SPEC-001', {
      storyId: 'US-001',
      title: 'Login Form Component',
      type: 'UI',
      agent: 'frontend-agent',
      filesCreate: ['src/features/auth/components/LoginForm.tsx'],
      filesModify: ['src/app/layout.tsx'],
      filesPreserve: ['src/lib/auth/legacy.ts'],
    });

    expect(result.id).toBe('T-001');
    const content = await fs.readFile(result.filePath, 'utf-8');
    expect(content).toContain('id: "T-001"');
    expect(content).toContain('storyId: "US-001"');
    expect(content).toContain('specId: "SPEC-001"');
    expect(content).toContain('type: "UI"');
    expect(content).toContain('agent: "frontend-agent"');
    expect(content).toContain('src/features/auth/components/LoginForm.tsx');
    expect(content).toContain('src/app/layout.tsx');
    expect(content).toContain('src/lib/auth/legacy.ts');
  });

  it('scopes T IDs per spec', async () => {
    await createSpec(projectDir, config, 'Auth');
    await createSpec(projectDir, config, 'Checkout');
    await createSpecStory(projectDir, config, 'SPEC-001', 'Login', {
      roleAction: 'user',
      benefit: 'reason',
    });
    await createSpecStory(projectDir, config, 'SPEC-002', 'Cart', {
      roleAction: 'user',
      benefit: 'reason',
    });

    const a = await createSpecTask(projectDir, config, 'SPEC-001', {
      storyId: 'US-001',
      title: 'Form',
      type: 'UI',
      agent: 'frontend-agent',
    });
    const b = await createSpecTask(projectDir, config, 'SPEC-002', {
      storyId: 'US-001',
      title: 'Cart Service',
      type: 'Tech',
      agent: 'backend-agent',
    });

    expect(a.id).toBe('T-001');
    expect(b.id).toBe('T-001'); // Per-spec scoping
  });
});

describe('listSpecStories / listSpecTasks', () => {
  it('returns stories sorted by ID with title and status', async () => {
    await createSpec(projectDir, config, 'Auth');
    await createSpecStory(projectDir, config, 'SPEC-001', 'Login', {
      roleAction: 'user',
      benefit: 'access',
    });
    await createSpecStory(projectDir, config, 'SPEC-001', 'Logout', {
      roleAction: 'user',
      benefit: 'sign out',
    });

    const specDir = getSpecDir(projectDir, config, 'SPEC-001', 'auth');
    const stories = await listSpecStories(specDir);
    expect(stories).toHaveLength(2);
    expect(stories[0].id).toBe('US-001');
    expect(stories[0].title).toBe('Login');
    expect(stories[1].id).toBe('US-002');
    expect(stories[1].title).toBe('Logout');
  });

  it('returns empty array for spec with no stories yet', async () => {
    await createSpec(projectDir, config, 'Auth');
    const specDir = getSpecDir(projectDir, config, 'SPEC-001', 'auth');
    expect(await listSpecStories(specDir)).toEqual([]);
    expect(await listSpecTasks(specDir)).toEqual([]);
  });
});

describe('attachSpecDesigns', () => {
  it('copies PNG files into design/ and updates ui_files frontmatter', async () => {
    await createSpec(projectDir, config, 'Auth');
    // Create a fake PNG to attach
    const fakePng = path.join(projectDir, 'mockup.png');
    await fs.writeFile(fakePng, 'fake-png-data');

    const result = await attachSpecDesigns(projectDir, config, 'SPEC-001', [fakePng]);
    expect(result.copied).toEqual(['mockup.png']);

    const dest = path.join(result.designDir, 'mockup.png');
    expect(existsSync(dest)).toBe(true);

    // Verify ui_files frontmatter updated
    const spec = await readSpec(projectDir, config, 'SPEC-001');
    expect(spec?.data.ui_files).toContain('design/mockup.png');
  });

  it('skips non-PNG files with warning', async () => {
    await createSpec(projectDir, config, 'Auth');
    const fakeFile = path.join(projectDir, 'notes.txt');
    await fs.writeFile(fakeFile, 'data');

    const result = await attachSpecDesigns(projectDir, config, 'SPEC-001', [fakeFile]);
    expect(result.copied).toEqual([]);
  });
});

describe('destroySpec', () => {
  it('removes the spec directory and all its contents', async () => {
    const { specDir } = await createSpec(projectDir, config, 'Auth');
    await createSpecStory(projectDir, config, 'SPEC-001', 'Login', {
      roleAction: 'user',
      benefit: 'access',
    });
    expect(existsSync(specDir)).toBe(true);

    await destroySpec(projectDir, config, 'SPEC-001');
    expect(existsSync(specDir)).toBe(false);
  });

  it('throws on unknown spec ID', async () => {
    await expect(destroySpec(projectDir, config, 'SPEC-999')).rejects.toThrow(/not found/);
  });
});

describe('getSpecStatus', () => {
  it('aggregates counts across all specs', async () => {
    await createSpec(projectDir, config, 'Auth');
    await createSpec(projectDir, config, 'Checkout');
    await createSpecStory(projectDir, config, 'SPEC-001', 'Login', {
      roleAction: 'user',
      benefit: 'access',
    });
    await createSpecTask(projectDir, config, 'SPEC-001', {
      storyId: 'US-001',
      title: 'Form',
      type: 'UI',
      agent: 'frontend-agent',
    });

    const report = await getSpecStatus(projectDir, config);
    expect(report.specCount).toBe(2);
    expect(report.totalStories).toBe(1);
    expect(report.totalTasks).toBe(1);
  });
});

describe('validateSpecForPromotion', () => {
  it('flags missing stories and tasks', async () => {
    await createSpec(projectDir, config, 'Auth');
    const result = await validateSpecForPromotion(projectDir, config, 'SPEC-001');
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.includes('No User Stories'))).toBe(true);
    expect(result.issues.some((i) => i.includes('No Tasks'))).toBe(true);
  });

  it('flags story without tasks', async () => {
    await createSpec(projectDir, config, 'Auth');
    await createSpecStory(projectDir, config, 'SPEC-001', 'Login', {
      roleAction: 'user',
      benefit: 'access',
    });
    // Create a task linked to a different (non-existent) story to force the
    // "story without tasks" branch
    await createSpecTask(projectDir, config, 'SPEC-001', {
      storyId: 'US-999',
      title: 'Stray',
      type: 'Tech',
      agent: 'backend-agent',
    });
    const result = await validateSpecForPromotion(projectDir, config, 'SPEC-001');
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.includes('US-001 has no tasks'))).toBe(true);
  });

  it('returns ready=true when stories + tasks line up', async () => {
    await createSpec(projectDir, config, 'Auth Flow with a Sufficiently Detailed Title');
    await createSpecStory(projectDir, config, 'SPEC-001', 'Login', {
      roleAction: 'user',
      benefit: 'access',
    });
    await createSpecTask(projectDir, config, 'SPEC-001', {
      storyId: 'US-001',
      title: 'Form',
      type: 'UI',
      agent: 'frontend-agent',
    });
    const result = await validateSpecForPromotion(projectDir, config, 'SPEC-001');
    expect(result.ready).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('flags spec with empty body', async () => {
    await createSpec(projectDir, config, 'A'); // very short title → short body
    // Manually overwrite body with nothing
    const { updateSpec } = await import('../../src/services/spec-service.js');
    await updateSpec(
      projectDir,
      config,
      'SPEC-001',
      `---\nid: "SPEC-001"\ntitle: "A"\nslug: "a"\nschemaVersion: "1.0.0"\nstatus: "pending"\npriority: "P1"\ncreated: "2026-04-25"\nupdated: "2026-04-25"\nui_files: []\ntech_dependencies: []\n---\n\nshort\n`,
    );
    await createSpecStory(projectDir, config, 'SPEC-001', 'Login', {
      roleAction: 'user',
      benefit: 'access',
    });
    await createSpecTask(projectDir, config, 'SPEC-001', {
      storyId: 'US-001',
      title: 'Form',
      type: 'UI',
      agent: 'frontend-agent',
    });
    const result = await validateSpecForPromotion(projectDir, config, 'SPEC-001');
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.includes('very short'))).toBe(true);
  });
});

describe('shapeSpec', () => {
  it('populates the body from the 4-question answers', async () => {
    const { specFile } = await createSpec(projectDir, config, 'Auth Flow', { slug: 'auth' });
    await shapeSpec(projectDir, config, 'SPEC-001', {
      context: 'Users need a secure way to log in to access their dashboard.',
      functionalRequirements: [
        'User can submit username + password',
        'System validates credentials',
        'On success, user is redirected to /dashboard',
      ],
      businessRules: 'Password must be 8+ chars. Lockout after 5 failures.',
      outOfScope: ['SSO', 'password reset (covered in feat-pw-reset)'],
      acceptanceCriteria: [
        'Given valid creds, when submitting, then user reaches /dashboard',
        'Given invalid creds, when submitting, then user sees error',
      ],
      decompositionNotes: 'Suggested split: 2 US — login form + session management',
    });

    const content = await fs.readFile(specFile, 'utf-8');
    // Body content should be present
    expect(content).toContain('Users need a secure way to log in');
    expect(content).toContain('User can submit username + password');
    expect(content).toContain('Password must be 8+ chars');
    expect(content).toContain('SSO');
    expect(content).toContain('Given valid creds, when submitting, then user reaches /dashboard');
    expect(content).toContain('Suggested split: 2 US');
  });

  it('updates status to "shaping"', async () => {
    await createSpec(projectDir, config, 'Auth');
    await shapeSpec(projectDir, config, 'SPEC-001', {
      context: 'context',
      functionalRequirements: ['req'],
      acceptanceCriteria: ['ac'],
    });
    const spec = await readSpec(projectDir, config, 'SPEC-001');
    expect(spec?.data.status).toBe('shaping');
  });

  it('preserves frontmatter fields (priority, milestone, po, ui_files)', async () => {
    await createSpec(projectDir, config, 'Auth', {
      priority: 'P0',
      milestone: 'v1.0',
      po: '@AsemDevs',
    });
    // Pre-populate ui_files so we can confirm shape preserves them
    const fakePng = path.join(projectDir, 'login.png');
    await fs.writeFile(fakePng, 'fake');
    await attachSpecDesigns(projectDir, config, 'SPEC-001', [fakePng]);

    await shapeSpec(projectDir, config, 'SPEC-001', {
      context: 'ctx',
      functionalRequirements: ['req'],
      acceptanceCriteria: ['ac'],
    });

    const spec = await readSpec(projectDir, config, 'SPEC-001');
    expect(spec?.data.priority).toBe('P0');
    expect(spec?.data.milestone).toBe('v1.0');
    expect(spec?.data.po).toBe('@AsemDevs');
    // ui_files should still be present
    expect(spec?.data.ui_files).toContain('design/login.png');
  });

  it('throws on unknown spec ID', async () => {
    await expect(
      shapeSpec(projectDir, config, 'SPEC-999', {
        context: 'c',
        functionalRequirements: ['r'],
        acceptanceCriteria: ['a'],
      }),
    ).rejects.toThrow(/not found/);
  });

  it('handles empty businessRules / outOfScope / decompositionNotes gracefully', async () => {
    await createSpec(projectDir, config, 'Auth');
    await shapeSpec(projectDir, config, 'SPEC-001', {
      context: 'just context',
      functionalRequirements: ['just one req'],
      acceptanceCriteria: ['just one ac'],
      // omit optional fields entirely
    });
    const spec = await readSpec(projectDir, config, 'SPEC-001');
    expect(spec).not.toBeNull();
    if (!spec) return;
    const content = await fs.readFile(spec.specFile, 'utf-8');
    expect(content).toContain('just context');
    expect(content).toContain('just one req');
    // Should fall back to placeholder when business rules empty
    expect(content).toContain('_None specified._');
    expect(content).toContain('_Nothing explicitly out of scope yet._');
  });
});

// ---------------------------------------------------------------------------
// decomposeSpec tests — uses vi.mock to stub the AI provider + codebase scanner
// ---------------------------------------------------------------------------

vi.mock('../../src/services/ai-service.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    isAIConfigured: vi.fn(() => true),
    getAIProvider: vi.fn(async () => ({
      name: 'mock',
      model: 'test',
      chat: async function* () {
        yield (globalThis as unknown as { __mockAIResponse?: string }).__mockAIResponse ?? '{}';
      },
      chatSync: async () =>
        (globalThis as unknown as { __mockAIResponse?: string }).__mockAIResponse ?? '{}',
      getLastUsage: () => undefined,
    })),
  };
});

vi.mock('../../src/ai/codebase/index.js', () => ({
  buildCodebaseContext: vi.fn(async () => ({
    techStack: { language: 'TypeScript', framework: 'NestJS' },
    folderTree: 'src/\n  features/\n',
    sourceInventory: '',
    architectureFiles: new Map(),
    relatedFiles: new Map(),
    projectRules: null,
    patternRules: [],
  })),
  extractKeywords: vi.fn(() => ['auth', 'login']),
  formatCodebaseContext: vi.fn(
    () => 'Tech Stack: TypeScript + NestJS\nFolder tree:\nsrc/\n  features/',
  ),
}));

vi.mock('../../src/utils/logger.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    createSpinner: () => ({ stop: vi.fn(), succeed: vi.fn(), update: vi.fn() }),
    formatUsage: () => '',
  };
});

/**
 * Helper: stash a fake AI JSON response so the mocked provider returns it
 * on the next call. The mock's `chat` generator reads from globalThis to
 * keep the mock factory simple.
 */
function setMockAIResponse(json: string): void {
  (globalThis as unknown as { __mockAIResponse?: string }).__mockAIResponse = json;
}

const validDecomposition = {
  stories: [
    {
      title: 'Login form submission',
      roleAction: 'a returning user, I want to submit valid credentials',
      benefit: 'I can access my dashboard',
      scope: 'Login form on /login route. Out of scope: SSO, password reset.',
      acceptanceCriteria: [
        'Given valid credentials, when submitting, then user reaches /dashboard',
        'Given invalid credentials, when submitting, then error is shown',
      ],
      tasks: [
        {
          title: 'Build login form component',
          type: 'UI' as const,
          agent: 'frontend-agent',
          filesCreate: ['src/features/auth/components/LoginForm.tsx'],
          filesModify: ['src/app/layout.tsx'],
          filesPreserve: ['src/lib/auth/legacy.ts'],
          objective: 'Implement the LoginForm component with email/password fields.',
          technicalSpec: 'Use react-hook-form. Submit via POST /auth/login.',
          testRequirements: 'Unit tests for happy path + invalid creds.',
        },
      ],
    },
    {
      title: 'Auth service backend',
      roleAction: 'the system, I want to validate credentials',
      benefit: 'only authorized users access protected routes',
      scope: 'Auth service + JWT issuance. Out of scope: refresh tokens.',
      acceptanceCriteria: ['Given valid creds, the service issues a JWT'],
      tasks: [
        {
          title: 'Implement AuthService.login',
          type: 'Tech' as const,
          agent: 'backend-agent',
          filesCreate: ['src/features/auth/auth.service.ts'],
          filesModify: ['src/app.module.ts'],
          filesPreserve: ['package.json'],
          objective: 'Implement the login method that returns a JWT.',
          technicalSpec: 'Use bcrypt for password hash compare.',
          testRequirements: 'Unit tests for valid/invalid creds.',
        },
      ],
    },
  ],
  decompositionNotes: 'Single-screen feature; 2-story decomposition is appropriate.',
};

describe('decomposeSpec', () => {
  beforeEach(() => {
    setMockAIResponse(JSON.stringify(validDecomposition));
  });

  it('writes US + Task files matching the AI response', async () => {
    await createSpec(projectDir, config, 'Auth Flow', { slug: 'auth' });
    const result = await decomposeSpec(projectDir, config, 'SPEC-001', { noCodeContext: true });

    expect(result.storiesCreated).toBe(2);
    expect(result.tasksCreated).toBe(2);
    expect(result.decompositionNotes).toContain('Single-screen');

    const specDir = getSpecDir(projectDir, config, 'SPEC-001', 'auth');
    const stories = await listSpecStories(specDir);
    const tasks = await listSpecTasks(specDir);

    expect(stories).toHaveLength(2);
    expect(stories[0].id).toBe('US-001');
    expect(stories[0].title).toBe('Login form submission');
    expect(stories[1].id).toBe('US-002');

    expect(tasks).toHaveLength(2);
    expect(tasks[0].id).toBe('T-001');
    expect(tasks[0].type).toBe('UI');
    expect(tasks[0].agent).toBe('frontend-agent');
    expect(tasks[0].storyId).toBe('US-001');
    expect(tasks[1].type).toBe('Tech');
    expect(tasks[1].agent).toBe('backend-agent');
  });

  it('updates SPEC frontmatter status to "decomposed"', async () => {
    await createSpec(projectDir, config, 'Auth');
    await decomposeSpec(projectDir, config, 'SPEC-001', { noCodeContext: true });
    const spec = await readSpec(projectDir, config, 'SPEC-001');
    expect(spec?.data.status).toBe('decomposed');
  });

  it('writes file Create/Modify/Preserve lists into task body', async () => {
    await createSpec(projectDir, config, 'Auth');
    await decomposeSpec(projectDir, config, 'SPEC-001', { noCodeContext: true });

    const specDir = getSpecDir(projectDir, config, 'SPEC-001', 'auth');
    const tasks = await listSpecTasks(specDir);
    const taskContent = await fs.readFile(tasks[0].filePath, 'utf-8');
    expect(taskContent).toContain('src/features/auth/components/LoginForm.tsx');
    expect(taskContent).toContain('src/app/layout.tsx');
    expect(taskContent).toContain('src/lib/auth/legacy.ts');
  });

  it('refuses to overwrite existing decomposition without --force', async () => {
    await createSpec(projectDir, config, 'Auth');
    await decomposeSpec(projectDir, config, 'SPEC-001', { noCodeContext: true });
    await expect(
      decomposeSpec(projectDir, config, 'SPEC-001', { noCodeContext: true }),
    ).rejects.toThrow(/already has \d+/);
  });

  it('overwrites existing decomposition with --force', async () => {
    await createSpec(projectDir, config, 'Auth');
    await decomposeSpec(projectDir, config, 'SPEC-001', { noCodeContext: true });
    // Call again with force; should succeed and produce same result
    const result = await decomposeSpec(projectDir, config, 'SPEC-001', {
      noCodeContext: true,
      force: true,
    });
    expect(result.storiesCreated).toBe(2);
  });

  it('rejects malformed AI output (Zod schema)', async () => {
    setMockAIResponse(JSON.stringify({ stories: [] })); // empty stories — violates min(1)
    await createSpec(projectDir, config, 'Auth');
    await expect(
      decomposeSpec(projectDir, config, 'SPEC-001', { noCodeContext: true }),
    ).rejects.toThrow();
  });

  it('rejects AI output with > 2 tasks per story', async () => {
    const tooManyTasks = {
      stories: [
        {
          title: 'X',
          roleAction: 'a user',
          benefit: 'reason',
          acceptanceCriteria: ['ac'],
          tasks: [
            { title: 't1', type: 'UI', agent: 'a', objective: 'o' },
            { title: 't2', type: 'Tech', agent: 'a', objective: 'o' },
            { title: 't3', type: 'Tech', agent: 'a', objective: 'o' }, // exceeds max(2)
          ],
        },
      ],
    };
    setMockAIResponse(JSON.stringify(tooManyTasks));
    await createSpec(projectDir, config, 'Auth');
    await expect(
      decomposeSpec(projectDir, config, 'SPEC-001', { noCodeContext: true }),
    ).rejects.toThrow();
  });

  it('throws on unknown spec ID', async () => {
    await expect(
      decomposeSpec(projectDir, config, 'SPEC-999', { noCodeContext: true }),
    ).rejects.toThrow(/not found/);
  });

  it('per-spec ID scoping: each spec gets its own US-001 + T-001', async () => {
    await createSpec(projectDir, config, 'Auth', { slug: 'auth' });
    await createSpec(projectDir, config, 'Checkout', { slug: 'checkout' });

    await decomposeSpec(projectDir, config, 'SPEC-001', { noCodeContext: true });
    await decomposeSpec(projectDir, config, 'SPEC-002', { noCodeContext: true });

    const authStories = await listSpecStories(getSpecDir(projectDir, config, 'SPEC-001', 'auth'));
    const checkoutStories = await listSpecStories(
      getSpecDir(projectDir, config, 'SPEC-002', 'checkout'),
    );
    expect(authStories[0].id).toBe('US-001');
    expect(checkoutStories[0].id).toBe('US-001'); // each spec scopes its own US-NNN
  });
});

describe('path resolvers', () => {
  it('getSpecsRootDir = .planr/specs/', () => {
    expect(getSpecsRootDir(projectDir, config)).toBe(path.join(projectDir, '.planr/specs'));
  });
});
