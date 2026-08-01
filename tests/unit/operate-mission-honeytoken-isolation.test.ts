import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AdvisorAdapter,
  type AdvisorOperatingContext,
  dispatchOperatingAdvisors,
} from '../../src/services/operate/advisors.js';
import { canonicalize } from '../../src/services/operate/canonical.js';
import {
  createMissionToolset,
  invokeMissionTool,
  MISSION_READ_ONLY_TOOLS,
  type MissionReadBoundary,
  narrowMissionRootsToCeiling,
  operatingRuntimeEnforcesBoundedReadOnly,
  resolveOperatingDispatchIsolation,
} from '../../src/services/operate/mission-dispatch.js';
import type {
  OperatingEvidence,
  OperatingEvidenceReadiness,
  OperatingRoleId,
} from '../../src/services/operate/types.js';

/**
 * Mission honeytoken containment proof (SPEC-001 FR2 / E-002).
 *
 * Unlike the SPEC-002 empty-tool suite (which proves an advisor payload carries
 * NO ambient state at all), a mission-mode lens is granted a bounded READ-ONLY
 * tool surface. This suite plants a distinct honeytoken in each channel a
 * mission lens must never reach — a file outside the declared roots, the process
 * environment, a callable tool surface, the network, and a file above the role's
 * sensitivity ceiling — and asserts every one is refused while an in-root,
 * at-or-below-ceiling read succeeds. The empty-tool suite continues to govern the
 * pack path exclusively and remains untouched.
 */
const FILE_TOKEN = 'mission-honeytoken-file-3c81a7d0';
const ENV_TOKEN = 'mission-honeytoken-env-9b42f6e1';
const NETWORK_TOKEN = 'mission-honeytoken-network-5d0e73fa';
const CEILING_TOKEN = 'mission-honeytoken-ceiling-a17c4b92';
const ESCAPE_TOKEN = 'mission-honeytoken-escape-7f2b1c9a';

const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

describe('Operating Board mission bounded read-only isolation (FR2/E-002)', () => {
  let projectRoot: string;
  let srcRoot: string;
  let appPath: string;
  let ceilingPath: string;
  let outsidePath: string;
  let boundary: MissionReadBoundary;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'openplanr-mission-honeytoken-'));
    srcRoot = join(projectRoot, 'src');
    await mkdir(srcRoot, { recursive: true });
    await mkdir(join(projectRoot, 'outside'), { recursive: true });

    appPath = join(srcRoot, 'app.ts');
    ceilingPath = join(srcRoot, 'secrets.ts');
    outsidePath = join(projectRoot, 'outside', 'leak.txt');

    // In-root, at-or-below-ceiling file: a mission lens MAY read this.
    await writeFile(appPath, `export const app = "${FILE_TOKEN}";\n`, 'utf8');
    // In-root but ABOVE the ceiling: must be refused at read time.
    await writeFile(ceilingPath, `const restricted = "${CEILING_TOKEN}";\n`, 'utf8');
    // Outside every declared root: a root escape must be refused.
    await writeFile(outsidePath, `LEAKED=${ESCAPE_TOKEN}\n`, 'utf8');

    process.env.OPENPLANR_MISSION_HONEYTOKEN = ENV_TOKEN;
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async () => {
      throw new Error(`unexpected network egress carrying ${NETWORK_TOKEN}`);
    }) as unknown as typeof fetch);

    boundary = {
      roots: [srcRoot],
      ceiling: 'internal',
      sensitivityByPath: new Map([
        [appPath, 'internal'],
        [ceilingPath, 'restricted'],
      ]),
      defaultSensitivity: 'internal',
    };
  });

  afterEach(async () => {
    delete process.env.OPENPLANR_MISSION_HONEYTOKEN;
    fetchSpy.mockRestore();
    await rm(projectRoot, { force: true, recursive: true, maxRetries: 10, retryDelay: 100 });
  });

  it('permits an in-root, at-or-below-ceiling read', async () => {
    const result = await invokeMissionTool(boundary, { tool: 'file-read', path: 'app.ts' });
    expect(result.tool).toBe('file-read');
    if (result.tool !== 'file-read') throw new Error('unexpected tool result');
    expect(result.content).toContain(FILE_TOKEN);
    // The read carries no ambient environment or network honeytoken.
    expect(result.content).not.toContain(ENV_TOKEN);
    expect(result.content).not.toContain(NETWORK_TOKEN);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a read above the sensitivity ceiling inside a granted root', async () => {
    await expect(
      invokeMissionTool(boundary, { tool: 'file-read', path: 'secrets.ts' }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_EVIDENCE_REJECTED' });
  });

  it('refuses a read that escapes the declared roots (absolute and traversal)', async () => {
    await expect(
      invokeMissionTool(boundary, { tool: 'file-read', path: outsidePath }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_PATH_ESCAPE' });
    await expect(
      invokeMissionTool(boundary, { tool: 'file-read', path: '../outside/leak.txt' }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_PATH_ESCAPE' });
  });

  it('refuses write, execute, network, and environment tools', async () => {
    for (const forbidden of ['file-write', 'shell-exec', 'network-fetch', 'env-read']) {
      await expect(
        invokeMissionTool(boundary, { tool: forbidden, path: 'app.ts' }),
      ).rejects.toMatchObject({ code: 'E_OPERATE_PROVIDER_READ_ONLY' });
    }
  });

  it('exposes only the bounded read-only tool surface — no write/exec/network/env callable', () => {
    const toolset = createMissionToolset(boundary);
    expect(Object.keys(toolset).sort()).toEqual([...MISSION_READ_ONLY_TOOLS].sort());
    for (const forbidden of [
      'file-write',
      'shell-exec',
      'network-fetch',
      'env-read',
      'process-env',
    ]) {
      expect((toolset as Record<string, unknown>)[forbidden]).toBeUndefined();
    }
    // No git-history, glob, or content-search tool is a write/exec/network channel.
    for (const tool of MISSION_READ_ONLY_TOOLS) {
      expect(/write|exec|shell|fetch|network|env/i.test(tool)).toBe(false);
    }
  });

  it('confines glob and content-search to in-root, at-or-below-ceiling files', async () => {
    const globbed = await invokeMissionTool(boundary, { tool: 'glob', pattern: '**/*.ts' });
    if (globbed.tool !== 'glob') throw new Error('unexpected tool result');
    expect(globbed.matches).toContain(appPath);
    // The above-ceiling file is never returned to the lens.
    expect(globbed.matches).not.toContain(ceilingPath);
    expect(globbed.matches.every((match) => match.startsWith(srcRoot))).toBe(true);

    const searched = await invokeMissionTool(boundary, {
      tool: 'content-search',
      query: FILE_TOKEN,
    });
    if (searched.tool !== 'content-search') throw new Error('unexpected tool result');
    expect(searched.matches.some((hit) => hit.path === appPath)).toBe(true);
    // The ceiling honeytoken never surfaces through search.
    const searchedCeiling = await invokeMissionTool(boundary, {
      tool: 'content-search',
      query: CEILING_TOKEN,
    });
    if (searchedCeiling.tool !== 'content-search') throw new Error('unexpected tool result');
    expect(searchedCeiling.matches).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('declares the granted roots whole, minus explicitly forbidden paths', () => {
    // The mandate model declares whole granted roots; a root that matches or is
    // nested under a forbidden path is dropped, and the result is deduplicated
    // and sorted. There is no evidence index to narrow against — the sensitivity
    // ceiling is enforced at read time by the bounded reader and at record time
    // by the citation resolver, not by dropping a root here.
    expect(
      narrowMissionRootsToCeiling({
        declaredRoots: ['src', 'docs', 'src'],
        forbiddenPaths: ['docs'],
      }),
    ).toEqual(['src']);
    // A nested forbidden path drops the whole matching root; an empty/absent
    // forbidden list leaves every granted root declared.
    expect(
      narrowMissionRootsToCeiling({
        declaredRoots: ['secrets', 'src'],
        forbiddenPaths: ['secrets/keys'],
      }),
    ).toEqual(['secrets', 'src']);
    expect(narrowMissionRootsToCeiling({ declaredRoots: ['src', 'docs'] })).toEqual([
      'docs',
      'src',
    ]);
  });

  it('reads a gitignored .planr/ tree — the mission tool walks the filesystem, not git ls-files (finding 2)', async () => {
    // A monorepo-shaped fixture whose `.planr/` control surface is gitignored:
    // the old collector took candidates from `git ls-files`, so a gitignored
    // `.planr/` was structurally unreadable. The mission tool surface walks the
    // filesystem directly, so a mandate whose declared roots include `.planr/`
    // can fully cite it regardless of git tracking.
    const planrRoot = join(projectRoot, '.planr');
    await mkdir(join(planrRoot, 'operate'), { recursive: true });
    await writeFile(join(projectRoot, '.gitignore'), '.planr/\n', 'utf8');
    const boardToken = 'planr-gitignored-board-6a2f';
    await writeFile(join(planrRoot, 'operate', 'board.md'), `# Board\n${boardToken}\n`, 'utf8');

    const planrBoundary: MissionReadBoundary = {
      roots: [planrRoot],
      ceiling: 'internal',
      defaultSensitivity: 'internal',
    };
    const read = await invokeMissionTool(planrBoundary, {
      tool: 'file-read',
      path: 'operate/board.md',
    });
    if (read.tool !== 'file-read') throw new Error('unexpected tool result');
    expect(read.content).toContain(boardToken);

    // Glob and content-search reach the gitignored tree the same way.
    const globbed = await invokeMissionTool(planrBoundary, { tool: 'glob', pattern: '**/*.md' });
    if (globbed.tool !== 'glob') throw new Error('unexpected tool result');
    expect(globbed.matches.some((match) => match.endsWith('board.md'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dispatch-mode reconciliation, determinism, and mixed-mode (FR2/FR4/E-004)
// ---------------------------------------------------------------------------

function evidence(): OperatingEvidence {
  return {
    kind: 'operating-evidence',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    cycleId: 'CYCLE-001',
    fingerprint: digest('a'),
    collectedAt: '2026-07-28T10:00:00.000Z',
    truncated: false,
    items: [],
    sources: [],
    warnings: [],
  };
}

function advisorContext(): AdvisorOperatingContext {
  return {
    snapshotDigest: digest('c'),
    charter: {
      purpose: 'Operate a trustworthy planning product.',
      stage: 'growth',
      businessModel: 'subscription',
      idealCustomer: 'technical founders',
      goals: ['Improve activation'],
      constraints: ['No autonomous deployment'],
      successMetrics: ['First brief in five minutes'],
      guardrails: ['No external writes'],
      knownUnknowns: ['Conversion baseline'],
    },
    priorCycle: null,
    openDecisions: [],
    openGaps: [],
    pendingOutcomes: [],
  };
}

function roleReadiness(roleId: OperatingRoleId): OperatingEvidenceReadiness['roles'][number] {
  return {
    roleId,
    readiness: 'ready',
    requirements: [],
    missingEvidence: [],
    evidenceRefs: [],
    modelCallAllowed: true,
    gapId: null,
  };
}

function readiness(roles: OperatingEvidenceReadiness['roles']): OperatingEvidenceReadiness {
  return {
    kind: 'operating-evidence-readiness',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    cycleId: 'CYCLE-001',
    inputDigest: digest('b'),
    evaluatedAt: '2026-07-28T10:00:01.000Z',
    roles,
  };
}

function structuredAdapter(parallelDispatch: boolean): AdvisorAdapter {
  return {
    id: 'mission-fixture',
    mode: 'structured',
    toolIsolation: 'not-applicable',
    capability: 'analysis-high',
    parallelDispatch,
    invoke: vi.fn(async () => ({
      outcome: 'quiet' as const,
      proposals: [],
      gaps: [],
      conflicts: [],
    })),
  };
}

describe('Operating Board runtime classification collapse (FR10/E-010)', () => {
  it('classifies claude-code as enforcing and codex/cursor as not enforcing', async () => {
    expect(await operatingRuntimeEnforcesBoundedReadOnly('claude')).toBe(true);
    expect(await operatingRuntimeEnforcesBoundedReadOnly('claude-code')).toBe(true);
    expect(await operatingRuntimeEnforcesBoundedReadOnly('codex')).toBe(false);
    expect(await operatingRuntimeEnforcesBoundedReadOnly('cursor')).toBe(false);
    // A runtime whose isolation cannot be verified never receives a native lens.
    expect(await operatingRuntimeEnforcesBoundedReadOnly(undefined)).toBe(false);
    expect(await operatingRuntimeEnforcesBoundedReadOnly('auto')).toBe(false);
  });

  it('classifies a mandate-capable runtime as enforced-read-only-bounded, first-class with no downgrade', () => {
    // A runtime that previously fell to the structured-provider path is now
    // first-class the moment it can carry a mandate: no capability gate downgrades it.
    const native = resolveOperatingDispatchIsolation({
      roleId: 'technology-risk',
      runtimeEnforcesBoundedReadOnly: true,
      adapterNativeCapable: true,
    });
    expect(native.isolation).toBe('enforced-read-only-bounded');
    expect(native.native).toBe(true);
    expect(native.isolation).not.toBe('unsupported');
  });

  it('classifies a runtime that cannot carry a mandate as unsupported, with an explicit reason and no silent fallback', () => {
    // Advisory/unverifiable runtime isolation: it cannot carry a mandate, so it
    // is declared unsupported for operate — never routed to a hidden path.
    const advisory = resolveOperatingDispatchIsolation({
      roleId: 'technology-risk',
      runtimeEnforcesBoundedReadOnly: false,
      adapterNativeCapable: true,
    });
    expect(advisory.isolation).toBe('unsupported');
    expect(advisory.native).toBe(false);
    expect(advisory.reconciliation).toMatch(/advisory|unverifiable|cannot carry a mandate/i);
    expect(advisory.reconciliation).toMatch(/no silent structured-provider fallback/i);

    // An adapter that cannot host a bounded native lens is unsupported too.
    const adapterIncapable = resolveOperatingDispatchIsolation({
      roleId: 'technology-risk',
      runtimeEnforcesBoundedReadOnly: true,
      adapterNativeCapable: false,
    });
    expect(adapterIncapable.isolation).toBe('unsupported');
    expect(adapterIncapable.reconciliation).toMatch(/adapter/i);

    // The classification is exactly two values — there is no third, silent path.
    for (const resolution of [advisory, adapterIncapable]) {
      expect(['enforced-read-only-bounded', 'unsupported']).toContain(resolution.isolation);
    }
  });

  it('records the unsupported classification with its reason in dispatch provenance, never a silent fallback', async () => {
    const result = await dispatchOperatingAdvisors({
      cycleId: 'CYCLE-001',
      evidence: evidence(),
      readiness: readiness([roleReadiness('technology-risk')]),
      context: advisorContext(),
      adapter: structuredAdapter(false),
      depth: 'standard',
      runtime: 'codex',
    });
    expect(result.provenance).toHaveLength(1);
    expect(result.provenance[0]).toMatchObject({
      roleId: 'technology-risk',
      isolation: 'unsupported',
    });
    // Codex is declared unsupported explicitly — never silently downgraded.
    expect(result.provenance[0].isolation).not.toBe('enforced-read-only-bounded');
    expect(result.provenance[0].reconciliation).toMatch(/advisory|unverifiable|unsupported/i);
  });

  it('reduces to byte-identical results across parallel, sequential, and dispatch order', async () => {
    const forward = readiness([roleReadiness('technology-risk'), roleReadiness('growth-market')]);
    const reversed = readiness([roleReadiness('growth-market'), roleReadiness('technology-risk')]);

    const parallel = await dispatchOperatingAdvisors({
      cycleId: 'CYCLE-001',
      evidence: evidence(),
      readiness: forward,
      context: advisorContext(),
      adapter: structuredAdapter(true),
      depth: 'standard',
      runtime: 'codex',
    });
    const sequential = await dispatchOperatingAdvisors({
      cycleId: 'CYCLE-001',
      evidence: evidence(),
      readiness: forward,
      context: advisorContext(),
      adapter: structuredAdapter(false),
      depth: 'standard',
      runtime: 'codex',
    });
    const reorderedSequential = await dispatchOperatingAdvisors({
      cycleId: 'CYCLE-001',
      evidence: evidence(),
      readiness: reversed,
      context: advisorContext(),
      adapter: structuredAdapter(false),
      depth: 'standard',
      runtime: 'codex',
    });

    expect(canonicalize(parallel.results)).toBe(canonicalize(sequential.results));
    expect(canonicalize(parallel.results)).toBe(canonicalize(reorderedSequential.results));
    expect(parallel.results.map((role) => role.roleId)).toEqual([
      'technology-risk',
      'growth-market',
    ]);
  });
});
