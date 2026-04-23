import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AIProvider, AIUsage } from '../../src/ai/types.js';
import type { ReviseAuditEntry, ReviseDecision } from '../../src/models/types.js';
import { createAuditLogWriter } from '../../src/services/audit-log-service.js';
import { createDefaultConfig } from '../../src/services/config-service.js';
import {
  applyDecision,
  isEffectivelyUnchanged,
  ReviseArtifactNotFoundError,
  reviseArtifact,
} from '../../src/services/revise-service.js';
import { ensureDir } from '../../src/utils/fs.js';

vi.mock('../../src/utils/logger.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/utils/logger.js')>(
    '../../src/utils/logger.js',
  );
  return {
    ...actual,
    createSpinner: () => ({
      stop: vi.fn(),
      succeed: vi.fn(),
      update: vi.fn(),
      fail: vi.fn(),
    }),
    formatUsage: () => '',
  };
});

function makeProvider(responseBody: string, usage?: AIUsage): AIProvider {
  return {
    name: 'anthropic',
    model: 'test-model',
    chatSync: vi.fn(async () => responseBody),
    chat: vi.fn(async function* () {
      yield responseBody;
    }),
    getLastUsage: vi.fn(() => usage),
  };
}

const VALID_REVISE_JSON = JSON.stringify({
  artifactId: 'EPIC-050',
  action: 'revise',
  revisedMarkdown: '---\nid: "EPIC-050"\n---\n# Updated\n',
  rationale: 'Title drift detected against PRD.',
  evidence: [{ type: 'sibling_artifact', ref: 'PRD-platform.md' }],
});

const VALID_SKIP_JSON = JSON.stringify({
  artifactId: 'EPIC-050',
  action: 'skip',
  rationale: 'No drift detected.',
});

async function seedEpic(tmpDir: string, config: ReturnType<typeof createDefaultConfig>) {
  const epicsDir = join(tmpDir, config.outputPaths.agile, 'epics');
  await ensureDir(epicsDir);
  const epicPath = join(epicsDir, 'EPIC-050-sample-epic.md');
  writeFileSync(
    epicPath,
    `---\nid: "EPIC-050"\ntitle: "Sample epic"\nstatus: "planning"\n---\n\n# EPIC-050: Sample epic\n\nSome body content.\n`,
  );
  return epicPath;
}

describe('reviseArtifact', () => {
  let tmpDir: string;
  const config = createDefaultConfig('test');

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'planr-revise-'));
    await seedEpic(tmpDir, config);
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns a validated revise decision for a valid artifact (US-035 scenario 1)', async () => {
    const provider = makeProvider(VALID_REVISE_JSON, { inputTokens: 500, outputTokens: 120 });
    const result = await reviseArtifact(tmpDir, config, provider, 'EPIC-050', {
      dryRun: true,
      noCodeContext: true,
    });

    expect(result.decision.action).toBe('revise');
    expect(result.decision.artifactId).toBe('EPIC-050');
    expect(result.decision.evidence).toHaveLength(1);
    expect(result.usage).toEqual({ inputTokens: 500, outputTokens: 120 });
    expect(result.contextStats.codebaseContextIncluded).toBe(false);
    expect(result.contextStats.parentsLoaded).toBe(0); // epic is top-level
  });

  it('returns a skip decision unchanged', async () => {
    const provider = makeProvider(VALID_SKIP_JSON);
    const result = await reviseArtifact(tmpDir, config, provider, 'EPIC-050', {
      dryRun: true,
      noCodeContext: true,
    });
    expect(result.decision.action).toBe('skip');
    expect(result.decision.revisedMarkdown).toBeUndefined();
  });

  it('throws ReviseArtifactNotFoundError for an unrecognized id prefix (US-036)', async () => {
    const provider = makeProvider(VALID_SKIP_JSON);
    await expect(
      reviseArtifact(tmpDir, config, provider, 'INVALID-999', {
        dryRun: true,
        noCodeContext: true,
      }),
    ).rejects.toThrow(ReviseArtifactNotFoundError);
  });

  it('throws ReviseArtifactNotFoundError when the artifact file is missing', async () => {
    const provider = makeProvider(VALID_SKIP_JSON);
    await expect(
      reviseArtifact(tmpDir, config, provider, 'EPIC-999', {
        dryRun: true,
        noCodeContext: true,
      }),
    ).rejects.toThrow(ReviseArtifactNotFoundError);
    await expect(
      reviseArtifact(tmpDir, config, provider, 'EPIC-999', {
        dryRun: true,
        noCodeContext: true,
      }),
    ).rejects.toThrow(/EPIC-999/);
  });

  it('passes the raw artifact (including frontmatter) into the prompt', async () => {
    const chatSync = vi.fn(async () => VALID_SKIP_JSON);
    const provider: AIProvider = {
      name: 'anthropic',
      model: 'test-model',
      chatSync,
      chat: vi.fn(async function* () {
        yield VALID_SKIP_JSON;
      }),
      getLastUsage: vi.fn(() => undefined),
    };

    await reviseArtifact(tmpDir, config, provider, 'EPIC-050', {
      dryRun: true,
      noCodeContext: true,
    });

    expect(chatSync).toHaveBeenCalledOnce();
    const firstCall = chatSync.mock.calls[0];
    const messages = firstCall[0] as Array<{ role: string; content: string }>;
    const userMessage = messages.find((m) => m.role === 'user');
    expect(userMessage).toBeDefined();
    // Frontmatter should be included so the agent can preserve it in revisedMarkdown.
    expect(userMessage?.content).toContain('id: "EPIC-050"');
    expect(userMessage?.content).toContain('[TARGET_ARTIFACT]');
    // Writable scope defaults to 'all'.
    expect(userMessage?.content).toContain('[WRITABLE_SCOPE]\nall');
  });

  it('resolves the artifact path with the .md extension preserved (regression: write-to-extensionless-file bug)', async () => {
    // Regression for a real user report: resolveArtifactFilename strips `.md`,
    // so a naive `path.join(dir, filename)` wrote to a file with no extension,
    // creating a duplicate alongside the original .md file. The write path
    // must always end in `.md`.
    const provider = makeProvider(VALID_SKIP_JSON);
    const result = await reviseArtifact(tmpDir, config, provider, 'EPIC-050', {
      dryRun: true,
      noCodeContext: true,
    });
    expect(result.artifactPath.endsWith('.md')).toBe(true);
    expect(result.artifactPath).toContain('EPIC-050-sample-epic.md');
  });

  it('reports unverified schema errors from the AI back to the caller', async () => {
    const badJson = JSON.stringify({
      artifactId: 'EPIC-050',
      action: 'revise',
      // Missing revisedMarkdown and evidence — superRefine will reject.
      rationale: 'bad',
    });
    const provider = makeProvider(badJson);
    await expect(
      reviseArtifact(tmpDir, config, provider, 'EPIC-050', {
        dryRun: true,
        noCodeContext: true,
      }),
    ).rejects.toThrow();
  });
});

describe('isEffectivelyUnchanged', () => {
  it('returns true for byte-identical content', () => {
    const s = '---\nid: "X"\n---\n\n# X\n\nhello\n';
    expect(isEffectivelyUnchanged(s, s)).toBe(true);
  });

  it('returns true when revised only differs in trailing newlines (LLM normalization)', () => {
    const original = '---\nid: "X"\n---\n\n# X\n\nhello\n';
    const revised = '---\nid: "X"\n---\n\n# X\n\nhello'; // no trailing newline
    expect(isEffectivelyUnchanged(original, revised)).toBe(true);
  });

  it('returns true when revised differs only by trailing whitespace', () => {
    const original = 'hello\n';
    const revised = 'hello  \t\n\n';
    expect(isEffectivelyUnchanged(original, revised)).toBe(true);
  });

  it('returns false when there is a real content change', () => {
    const original = '---\nid: "X"\n---\n\n# X\n\nhello\n';
    const revised = '---\nid: "X"\n---\n\n# X\n\nhello world\n';
    expect(isEffectivelyUnchanged(original, revised)).toBe(false);
  });

  it('returns true when revised is undefined (agent gave no replacement)', () => {
    expect(isEffectivelyUnchanged('hello\n', undefined)).toBe(true);
  });

  it('returns false for internal whitespace differences (mid-line changes matter)', () => {
    const original = 'a b\n';
    const revised = 'a  b\n';
    expect(isEffectivelyUnchanged(original, revised)).toBe(false);
  });
});

describe('applyDecision — unchanged-by-agent short-circuit', () => {
  let projectDir: string;
  let backupDir: string;

  beforeAll(async () => {
    projectDir = mkdtempSync(join(tmpdir(), 'planr-revise-apply-'));
    backupDir = join(projectDir, '.planr', 'reports', 'backup');
    await ensureDir(backupDir);
  });

  afterAll(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  function makeWriter() {
    return createAuditLogWriter({
      projectDir,
      scope: 'test',
      cascade: false,
      dryRun: false,
      format: 'json',
      overridePath: join(backupDir, `audit-${Date.now()}-${Math.random()}.json`),
    });
  }

  function baseDecision(overrides: Partial<ReviseDecision> = {}): ReviseDecision {
    return {
      artifactId: 'QT-999',
      action: 'revise',
      rationale: 'ok',
      evidence: [],
      ambiguous: [],
      revisedMarkdown: '',
      ...overrides,
    } as ReviseDecision;
  }

  it('does NOT write the file when revisedMarkdown equals original (byte-identical)', async () => {
    const original = '---\nid: "QT-999"\n---\n\n# QT-999\n\nuntouched\n';
    const artifactPath = join(projectDir, 'QT-999.md');
    writeFileSync(artifactPath, original, 'utf-8');
    const writer = makeWriter();

    const result = await applyDecision({
      artifactPath,
      originalContent: original,
      decision: baseDecision({ revisedMarkdown: original }),
      backupDir,
      audit: writer,
      dryRun: false,
    });

    expect(result.outcome).toBe('unchanged-by-agent');
    expect(result.wrote).toBe(false);
    expect(result.diff).toBe('');
    // File untouched — and critically, no backup sidecar produced (since
    // nothing was overwritten).
    expect(readFileSync(artifactPath, 'utf-8')).toBe(original);
    expect(existsSync(join(backupDir, 'QT-999.md.bak'))).toBe(false);
  });

  it('does NOT write the file when revisedMarkdown only differs in trailing whitespace', async () => {
    // This is the exact bug the user hit on QT-004: the AI returned the
    // artifact minus one trailing newline, and the apply path wrote anyway,
    // stripping the newline and reporting `applied` for a no-op.
    const original = '---\nid: "QT-999"\n---\n\n# QT-999\n\nuntouched\n\n';
    const revised = original.trimEnd(); // AI serializer dropped trailing newlines
    const artifactPath = join(projectDir, 'QT-999-trailing.md');
    writeFileSync(artifactPath, original, 'utf-8');
    const writer = makeWriter();

    const result = await applyDecision({
      artifactPath,
      originalContent: original,
      decision: baseDecision({ artifactId: 'QT-999-trailing', revisedMarkdown: revised }),
      backupDir,
      audit: writer,
      dryRun: false,
    });

    expect(result.outcome).toBe('unchanged-by-agent');
    expect(result.wrote).toBe(false);
    // The original file including its trailing newlines is preserved exactly.
    expect(readFileSync(artifactPath, 'utf-8')).toBe(original);
  });

  it('DOES write the file for a real content change', async () => {
    const original = '---\nid: "QT-999"\n---\n\n# QT-999\n\nhello\n';
    const revised = '---\nid: "QT-999"\n---\n\n# QT-999\n\nhello world\n';
    const artifactPath = join(projectDir, 'QT-999-real.md');
    writeFileSync(artifactPath, original, 'utf-8');
    const writer = makeWriter();

    const result = await applyDecision({
      artifactPath,
      originalContent: original,
      decision: baseDecision({ artifactId: 'QT-999-real', revisedMarkdown: revised }),
      backupDir,
      audit: writer,
      dryRun: false,
    });

    expect(result.outcome).toBe('applied');
    expect(result.wrote).toBe(true);
    expect(readFileSync(artifactPath, 'utf-8')).toBe(revised);
  });

  it('emits an `unchanged-by-agent` audit entry with no diff body', async () => {
    const original = 'same\n';
    const artifactPath = join(projectDir, 'QT-999-audit.md');
    writeFileSync(artifactPath, original, 'utf-8');
    const auditPath = join(backupDir, `audit-entry-${Date.now()}.json`);
    const writer = createAuditLogWriter({
      projectDir,
      scope: 'test',
      cascade: false,
      dryRun: false,
      format: 'json',
      overridePath: auditPath,
    });

    await applyDecision({
      artifactPath,
      originalContent: original,
      decision: baseDecision({ artifactId: 'QT-999-audit', revisedMarkdown: original }),
      backupDir,
      audit: writer,
      dryRun: false,
    });
    writer.close();

    const raw = readFileSync(auditPath, 'utf-8');
    const parsed = JSON.parse(raw) as { entries: ReviseAuditEntry[] };
    const entry = parsed.entries.find((e) => e.artifactId === 'QT-999-audit');
    expect(entry?.outcome).toBe('unchanged-by-agent');
    expect(entry?.diff).toBeUndefined();
  });
});
