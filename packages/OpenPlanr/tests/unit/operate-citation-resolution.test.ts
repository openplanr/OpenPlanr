import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { resolvePlanrArtifactCitation } from '../../src/services/operate/artifacts.js';
import { canonicalDigest } from '../../src/services/operate/canonical.js';
import {
  type CitationResolutionContext,
  enforceProposalCitations,
  resolveOperatingCitationAtPin,
} from '../../src/services/operate/citation-resolution.js';
import { gateRecordedProposalCitations } from '../../src/services/operate/engine.js';
import { OperatingEvidenceCache } from '../../src/services/operate/evidence-cache.js';
import { enforceRecordedProposalCitations } from '../../src/services/operate/interaction/action-service.js';
import type {
  OperatingRoleResult,
  OperatingWorkspaceComponent,
} from '../../src/services/operate/types.js';
import { resolvePipelinePackage } from '../../src/services/pipeline-package-service.js';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

const SERVICE_CONTENT = 'export function add(a: number, b: number): number {\n  return a + b;\n}\n';
// A hard-blocked secret category (a known GitHub token): a citation into this
// content is rejected as `unresolvable`, never redacted-and-accepted.
const HARD_SECRET_TOKEN = 'ghp_0123456789012345678901234567890123';
const HARD_SECRET_CONTENT = `export const githubToken = "${HARD_SECRET_TOKEN}";\n`;
// A SOFT secret (a bare secret-shaped assignment): still redacted-and-accepted,
// so the snapshot never carries the raw value.
const SOFT_SECRET_VALUE = 'swordfish-not-a-real-token';
const SOFT_SECRET_CONTENT = `API_PASSWORD=${SOFT_SECRET_VALUE}\n`;
const STORY_CONTENT = '# US-001 — Resolve citations\n\nThe engine resolves citations at the pin.\n';

interface Fixture {
  projectRoot: string;
  head: string;
  parent: string;
  cleanDescriptor: OperatingWorkspaceComponent;
  dirtyDescriptor: OperatingWorkspaceComponent;
  cacheRoot: string;
  context: CitationResolutionContext;
  cache: OperatingEvidenceCache;
}

async function git(projectRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd: projectRoot });
  return stdout.trim();
}

async function buildFixture(): Promise<Fixture> {
  const projectRoot = await temporaryDirectory('openplanr-operate-citation-project-');
  await git(projectRoot, ['init', '--quiet']);
  await git(projectRoot, ['config', 'user.name', 'OpenPlanr Test']);
  await git(projectRoot, ['config', 'user.email', 'test@openplanr.invalid']);
  await mkdir(join(projectRoot, 'src'), { recursive: true });
  await mkdir(join(projectRoot, '.planr', 'stories'), { recursive: true });
  await writeFile(join(projectRoot, 'src', 'service.ts'), SERVICE_CONTENT);
  await writeFile(join(projectRoot, 'src', 'secrets.ts'), HARD_SECRET_CONTENT);
  await writeFile(join(projectRoot, 'src', 'soft-secret.txt'), SOFT_SECRET_CONTENT);
  await writeFile(join(projectRoot, '.planr', 'stories', 'US-001-foo.md'), STORY_CONTENT);
  await git(projectRoot, ['add', '-A']);
  await git(projectRoot, ['commit', '--quiet', '-m', 'first']);
  const parent = await git(projectRoot, ['rev-parse', 'HEAD']);
  await writeFile(join(projectRoot, 'README.md'), '# Fixture\n');
  await git(projectRoot, ['add', 'README.md']);
  await git(projectRoot, ['commit', '--quiet', '-m', 'second']);
  const head = await git(projectRoot, ['rev-parse', 'HEAD']);

  const cleanDescriptor: OperatingWorkspaceComponent = {
    componentId: 'control',
    canonicalRemote: 'github.com/openplanr/citation-fixture',
    configuredBranch: 'main',
    pinnedRevision: head,
    dirtyFingerprint: null,
    readOnly: false,
  };
  const dirtyDescriptor: OperatingWorkspaceComponent = {
    ...cleanDescriptor,
    dirtyFingerprint: `sha256:${'d'.repeat(64)}`,
  };

  const cacheRoot = await temporaryDirectory('openplanr-operate-citation-cache-');
  const cache = new OperatingEvidenceCache(cacheRoot, 'restricted');
  const context: CitationResolutionContext = {
    projectRoot,
    cycleId: 'CYCLE-001',
    descriptor: cleanDescriptor,
    cache,
    now: new Date('2026-07-31T00:00:00.000Z'),
  };
  return { projectRoot, head, parent, cleanDescriptor, dirtyDescriptor, cacheRoot, context, cache };
}

// FR8 fixture-matrix helpers. Each named fixture below builds a purpose-shaped
// repository rather than reusing buildFixture, because the classification
// behaviour under test depends on the exact git/`.planr/` topology (gitignored
// vs tracked, single vs nested repository, present vs renamed artifact).
async function initGitProject(prefix: string): Promise<string> {
  const projectRoot = await temporaryDirectory(prefix);
  await git(projectRoot, ['init', '--quiet']);
  await git(projectRoot, ['config', 'user.name', 'OpenPlanr Test']);
  await git(projectRoot, ['config', 'user.email', 'test@openplanr.invalid']);
  return projectRoot;
}

function controlDescriptor(head: string, dirty = false): OperatingWorkspaceComponent {
  return {
    componentId: 'control',
    canonicalRemote: 'github.com/openplanr/citation-fixture',
    configuredBranch: 'main',
    pinnedRevision: head,
    dirtyFingerprint: dirty ? `sha256:${'d'.repeat(64)}` : null,
    readOnly: false,
  };
}

function contextFor(
  projectRoot: string,
  descriptor: OperatingWorkspaceComponent,
  cache: OperatingEvidenceCache,
): CitationResolutionContext {
  return {
    projectRoot,
    cycleId: 'CYCLE-001',
    descriptor,
    cache,
    now: new Date('2026-07-31T00:00:00.000Z'),
  };
}

async function newCache(): Promise<OperatingEvidenceCache> {
  const cacheRoot = await temporaryDirectory('openplanr-operate-citation-cache-');
  return new OperatingEvidenceCache(cacheRoot, 'restricted');
}

/** The required non-citation fields of a recorded proposal, kept out of each test's noise. */
function baseProposal(title: string) {
  return {
    type: 'finding' as const,
    title,
    problem: 'A grounded problem statement for the fixture.',
    proposal: 'A grounded proposal for the fixture.',
    impact: 3,
    confidence: 3,
    ease: 3,
    severity: 'medium' as const,
    evidenceRefs: [] as string[],
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
      ),
  );
});

describe('Operating Board citation resolution', () => {
  it('snapshots a valid repository path + line range byte-faithfully and returns its evidence id', async () => {
    const fixture = await buildFixture();
    const resolved = await resolveOperatingCitationAtPin(
      {
        repositoryPath: 'src/service.ts',
        lineRange: { start: 1, end: 3 },
        pinnedRevision: fixture.head,
      },
      fixture.context,
    );
    expect(resolved.outcome).toBe('resolved');
    expect(resolved.evidenceId).toMatch(/^EVD-[a-f0-9]+$/);
    const snapshot = await fixture.cache.getCitationSnapshot(
      resolved.evidenceId as string,
      fixture.context.now,
    );
    expect(snapshot?.content).toBe(SERVICE_CONTENT);
    expect(snapshot?.sourceLocation).toBe('src/service.ts');
    expect(snapshot?.sensitivity).toBe('internal');
  });

  it('rejects a fabricated path, a wrong line range, and a moved revision with distinct reasons and one gap each', async () => {
    const fixture = await buildFixture();

    const fabricated = await resolveOperatingCitationAtPin(
      { repositoryPath: 'src/missing.ts', pinnedRevision: fixture.head },
      fixture.context,
    );
    expect(fabricated.outcome).toBe('rejected');
    expect(fabricated.reason).toBe('fabricated-path');
    expect(fabricated.gap?.category).toBe('unresolvable-citation');
    expect(fabricated.evidenceId).toBeUndefined();

    const wrongRange = await resolveOperatingCitationAtPin(
      {
        repositoryPath: 'src/service.ts',
        lineRange: { start: 1, end: 9999 },
        pinnedRevision: fixture.head,
      },
      fixture.context,
    );
    expect(wrongRange.outcome).toBe('rejected');
    expect(wrongRange.reason).toBe('wrong-line-range');
    expect(wrongRange.gap?.id).toMatch(/^GAP-/);

    // The advisor cited src/service.ts at the parent commit; it exists there, so
    // the rejection is the moved revision, not a fabricated path.
    const movedRevision = await resolveOperatingCitationAtPin(
      {
        repositoryPath: 'src/service.ts',
        lineRange: { start: 1, end: 3 },
        pinnedRevision: fixture.parent,
      },
      fixture.context,
    );
    expect(movedRevision.outcome).toBe('rejected');
    expect(movedRevision.reason).toBe('stale-revision');

    const gapIds = new Set(
      [fabricated, wrongRange, movedRevision].map((resolution) => resolution.gap?.id),
    );
    expect(gapIds.size).toBe(3);
  });

  it('resolves and snapshots a planr artifact citation through the shared redaction path', async () => {
    const fixture = await buildFixture();
    const artifact = await resolvePlanrArtifactCitation({
      projectRoot: fixture.projectRoot,
      pinnedRevision: fixture.head,
      artifactId: 'US-001',
    });
    expect(artifact.artifactExists).toBe(true);
    expect(artifact.location).toBe('.planr/stories/US-001-foo.md');

    const resolved = await resolveOperatingCitationAtPin(
      { planrArtifactId: 'US-001', pinnedRevision: fixture.head },
      fixture.context,
    );
    expect(resolved.outcome).toBe('resolved');
    const snapshot = await fixture.cache.getCitationSnapshot(
      resolved.evidenceId as string,
      fixture.context.now,
    );
    expect(snapshot?.content).toContain('US-001');

    const missing = await resolveOperatingCitationAtPin(
      { planrArtifactId: 'US-909', pinnedRevision: fixture.head },
      fixture.context,
    );
    expect(missing.outcome).toBe('rejected');
    expect(missing.reason).toBe('unresolvable');
  });

  it('names an uncommitted working-tree citation distinctly from a fabricated path', async () => {
    const fixture = await buildFixture();
    await writeFile(
      join(fixture.projectRoot, 'src', 'uncommitted.ts'),
      'export const inFlight = 1;\n',
    );
    const dirtyContext: CitationResolutionContext = {
      ...fixture.context,
      descriptor: fixture.dirtyDescriptor,
    };

    const dirty = await resolveOperatingCitationAtPin(
      { repositoryPath: 'src/uncommitted.ts', pinnedRevision: fixture.head },
      dirtyContext,
    );
    expect(dirty.outcome).toBe('rejected');
    expect(dirty.reason).toBe('dirty-working-tree');
    expect(dirty.reason).not.toBe('fabricated-path');
    expect(dirty.gap?.category).toBe('unresolvable-citation');

    // A path absent from the working tree is still a fabricated path even in a dirty tree.
    const fabricated = await resolveOperatingCitationAtPin(
      { repositoryPath: 'src/never-existed.ts', pinnedRevision: fixture.head },
      dirtyContext,
    );
    expect(fabricated.reason).toBe('fabricated-path');
  });

  it('redacts a SOFT secret in cited content so it never appears raw in the persisted snapshot', async () => {
    const fixture = await buildFixture();
    const resolved = await resolveOperatingCitationAtPin(
      {
        repositoryPath: 'src/soft-secret.txt',
        lineRange: { start: 1, end: 1 },
        pinnedRevision: fixture.head,
      },
      fixture.context,
    );
    // A bare secret-shaped assignment is redacted-and-accepted (soft category).
    expect(resolved.outcome).toBe('resolved');
    const snapshot = await fixture.cache.getCitationSnapshot(
      resolved.evidenceId as string,
      fixture.context.now,
    );
    expect(snapshot?.content).not.toContain(SOFT_SECRET_VALUE);
    expect(snapshot?.content).toContain('[REDACTED]');

    // No cache file on disk contains the raw secret bytes.
    for (const name of await readdir(fixture.cacheRoot)) {
      const raw = await readFile(join(fixture.cacheRoot, name), 'utf8');
      expect(raw).not.toContain(SOFT_SECRET_VALUE);
    }
  });

  it('rejects a citation into HARD-blocked-secret content as unresolvable, never redacted-and-accepted', async () => {
    const fixture = await buildFixture();
    const resolved = await resolveOperatingCitationAtPin(
      {
        repositoryPath: 'src/secrets.ts',
        lineRange: { start: 1, end: 1 },
        pinnedRevision: fixture.head,
      },
      fixture.context,
    );
    // A hard-blocked secret (a known token) is refused outright — no snapshot,
    // no evidence id, one governed unresolvable-citation gap.
    expect(resolved.outcome).toBe('rejected');
    expect(resolved.reason).toBe('unresolvable');
    expect(resolved.evidenceId).toBeUndefined();
    expect(resolved.gap?.category).toBe('unresolvable-citation');

    // The rejected citation was never snapshotted, so no cache file exists at all,
    // and certainly none carrying the raw token.
    for (const name of await readdir(fixture.cacheRoot)) {
      const raw = await readFile(join(fixture.cacheRoot, name), 'utf8');
      expect(raw).not.toContain(HARD_SECRET_TOKEN);
    }
  });

  it('commits a role not_evaluated with a governed gap when its citations resolve zero evidence', async () => {
    const fixture = await buildFixture();
    const roleResult = {
      kind: 'operating-role-result',
      schemaVersion: '1.0.0',
      protocolVersion: '1.2.0',
      cycleId: 'CYCLE-001',
      roleId: 'strategy-finance',
      inputDigest: `sha256:${'a'.repeat(64)}`,
      resultDigest: `sha256:${'b'.repeat(64)}`,
      outcome: 'proposals',
      proposals: [
        {
          proposalKey: 'ungrounded',
          type: 'finding',
          title: 'A claim that grounds nothing',
          problem: 'The cited path does not exist at the pin.',
          proposal: 'Rework the finding against real evidence.',
          impact: 3,
          confidence: 3,
          ease: 3,
          severity: 'medium',
          evidenceRefs: [],
          citations: [{ repositoryPath: 'src/missing.ts', pinnedRevision: fixture.head }],
        },
      ],
      gaps: [],
      conflicts: [],
      producer: { product: 'openplanr', version: '1.19.0', runtime: 'claude' },
    } as unknown as OperatingRoleResult;

    const gated = await gateRecordedProposalCitations({
      roleResults: [roleResult],
      context: fixture.context,
    });

    // The role grounded zero evidence, so it is not_evaluated: every proposal is
    // dropped and a governed missing-evidence gap names the role and its empty
    // grounding.
    expect(gated.notEvaluatedRoleIds).toContain('strategy-finance');
    expect(gated.roleResults[0].proposals).toHaveLength(0);
    const namesRole = (gap: (typeof gated.gaps)[number]): boolean =>
      (gap.affectedRoles ?? []).includes('strategy-finance' as never);
    const roleGap = gated.gaps.find((gap) => gap.category === 'missing-evidence' && namesRole(gap));
    expect(roleGap).toBeDefined();
    expect(roleGap?.category).toBe('missing-evidence');
    // T-017: the co-occurring unresolvable-citation gap also names the role now,
    // so the integrity summary can link the citation rejection to it (the signal
    // the Chair board uses to classify the role citation-rejected, not just absent).
    const citationGap = gated.gaps.find(
      (gap) => gap.category === 'unresolvable-citation' && namesRole(gap),
    );
    expect(citationGap).toBeDefined();
  });

  it('inherits the cited file sensitivity into the persisted snapshot', async () => {
    const fixture = await buildFixture();
    const confidentialContext: CitationResolutionContext = {
      ...fixture.context,
      sensitivityFor: () => 'confidential',
    };
    const resolved = await resolveOperatingCitationAtPin(
      {
        repositoryPath: 'src/service.ts',
        lineRange: { start: 1, end: 3 },
        pinnedRevision: fixture.head,
      },
      confidentialContext,
    );
    const snapshot = await fixture.cache.getCitationSnapshot(
      resolved.evidenceId as string,
      fixture.context.now,
    );
    expect(snapshot?.sensitivity).toBe('confidential');
  });

  it('keeps a proposal with any unresolvable citation out of the accepted set and opens one gap', async () => {
    const fixture = await buildFixture();
    const proposals = [
      {
        proposalKey: 'p-valid',
        citations: [
          {
            repositoryPath: 'src/service.ts',
            lineRange: { start: 1, end: 3 },
            pinnedRevision: fixture.head,
          },
          { planrArtifactId: 'US-001', pinnedRevision: fixture.head },
        ],
      },
      {
        proposalKey: 'p-unresolvable',
        citations: [
          {
            repositoryPath: 'src/service.ts',
            lineRange: { start: 1, end: 3 },
            pinnedRevision: fixture.head,
          },
          { repositoryPath: 'src/missing.ts', pinnedRevision: fixture.head },
        ],
      },
    ];

    const enforcement = await enforceRecordedProposalCitations(proposals, fixture.context);
    expect(enforcement.accepted.map((entry) => entry.proposal.proposalKey)).toEqual(['p-valid']);
    expect(enforcement.accepted[0].evidenceRefs).toHaveLength(2);
    expect(enforcement.rejected.map((entry) => entry.proposalKey)).toEqual(['p-unresolvable']);
    expect(enforcement.rejected[0].reason).toBe('fabricated-path');
    expect(enforcement.gaps).toHaveLength(1);
    expect(enforcement.gaps[0].category).toBe('unresolvable-citation');
    // The direct enforce entrypoint agrees with the action-service seam.
    const direct = await enforceProposalCitations(proposals, fixture.context);
    expect(direct.accepted).toHaveLength(1);
  });
});

describe('FR8 citation-classification fixture matrix', () => {
  it('resolves a citation into a gitignored .planr/ file with a verified content digest', async () => {
    const projectRoot = await initGitProject('openplanr-operate-citation-gitignored-');
    await mkdir(join(projectRoot, 'src'), { recursive: true });
    await mkdir(join(projectRoot, '.planr', 'stories'), { recursive: true });
    await writeFile(join(projectRoot, 'src', 'service.ts'), SERVICE_CONTENT);
    await writeFile(
      join(projectRoot, '.planr', 'stories', 'US-001-foo.md'),
      '# US-001 — Gitignored planning\n\nThis story lives only on disk.\n',
    );
    // The planning directory is gitignored — never committed to any revision.
    await writeFile(join(projectRoot, '.gitignore'), '.planr/\n');
    await git(projectRoot, ['add', '-A']);
    await git(projectRoot, ['commit', '--quiet', '-m', 'first']);
    const head = await git(projectRoot, ['rev-parse', 'HEAD']);

    // The artifact is genuinely absent from the committed revision, so a
    // repository read at the pin cannot see it.
    await expect(
      git(projectRoot, ['show', `${head}:.planr/stories/US-001-foo.md`]),
    ).rejects.toThrow();

    const cache = await newCache();
    const context = contextFor(projectRoot, controlDescriptor(head), cache);
    const resolved = await resolveOperatingCitationAtPin(
      { planrArtifactId: 'US-001', pinnedRevision: head },
      context,
    );

    expect(resolved.outcome).toBe('resolved');
    expect(resolved.expectedCitationKind).toBe('planr-artifact');
    expect(resolved.snapshotDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(resolved.evidenceId).toMatch(/^EVD-[a-f0-9]+$/);
    const snapshot = await cache.getCitationSnapshot(resolved.evidenceId as string, context.now);
    expect(snapshot?.content).toContain('This story lives only on disk.');
    expect(snapshot?.sourceLocation).toBe('.planr/stories/US-001-foo.md');
  });

  it('resolves a tracked .planr/ artifact against the committed pin, not the working copy', async () => {
    const fixture = await buildFixture();
    // buildFixture commits .planr/stories/US-001-foo.md (tracked). Edit the
    // working copy AFTER the pin; resolution must snapshot the committed content.
    await writeFile(
      join(fixture.projectRoot, '.planr', 'stories', 'US-001-foo.md'),
      '# US-001 — WORKING-EDIT\n\nUncommitted edit that must not be snapshotted.\n',
    );
    const resolved = await resolveOperatingCitationAtPin(
      { planrArtifactId: 'US-001', pinnedRevision: fixture.head },
      fixture.context,
    );
    expect(resolved.outcome).toBe('resolved');
    expect(resolved.expectedCitationKind).toBe('planr-artifact');
    const snapshot = await fixture.cache.getCitationSnapshot(
      resolved.evidenceId as string,
      fixture.context.now,
    );
    expect(snapshot?.content).toContain('The engine resolves citations at the pin.');
    expect(snapshot?.content).not.toContain('WORKING-EDIT');
  });

  it('resolves a proposal that mixes repository, git-revision, and planr-artifact citation kinds', async () => {
    const fixture = await buildFixture();
    const enforcement = await enforceProposalCitations(
      [
        {
          proposalKey: 'mixed',
          citations: [
            {
              repositoryPath: 'src/service.ts',
              lineRange: { start: 1, end: 3 },
              pinnedRevision: fixture.head,
            },
            { gitRevision: fixture.head, pinnedRevision: fixture.head },
            { planrArtifactId: 'US-001', pinnedRevision: fixture.head },
          ],
        },
      ],
      fixture.context,
    );

    expect(enforcement.rejected).toHaveLength(0);
    expect(enforcement.accepted.map((entry) => entry.proposal.proposalKey)).toEqual(['mixed']);
    // Each distinct kind mints its own evidence id.
    expect(enforcement.accepted[0].evidenceRefs).toHaveLength(3);
    const kinds = new Set(
      enforcement.resolutions.map((resolution) => resolution.expectedCitationKind),
    );
    expect(kinds).toEqual(new Set(['repo-path', 'git-revision', 'planr-artifact']));
  });

  it('drops only the invalid proposal, preserving the two valid proposals and the analysisMarkdown', async () => {
    const fixture = await buildFixture();
    const analysisMarkdown =
      '# Strategy-finance\n\nStrong analysis that must survive one bad reference.\n';
    const roleResult = {
      kind: 'operating-role-result',
      schemaVersion: '1.0.0',
      protocolVersion: '1.2.0',
      cycleId: 'CYCLE-001',
      roleId: 'strategy-finance',
      inputDigest: `sha256:${'a'.repeat(64)}`,
      resultDigest: `sha256:${'b'.repeat(64)}`,
      outcome: 'proposals',
      analysisMarkdown,
      proposals: [
        {
          proposalKey: 'valid-repo',
          ...baseProposal('A grounded repository claim'),
          citations: [
            {
              repositoryPath: 'src/service.ts',
              lineRange: { start: 1, end: 3 },
              pinnedRevision: fixture.head,
            },
          ],
        },
        {
          proposalKey: 'valid-planr',
          ...baseProposal('A grounded planning claim'),
          citations: [{ planrArtifactId: 'US-001', pinnedRevision: fixture.head }],
        },
        {
          proposalKey: 'invalid',
          ...baseProposal('An ungrounded claim'),
          citations: [{ repositoryPath: 'src/missing.ts', pinnedRevision: fixture.head }],
        },
      ],
      gaps: [],
      conflicts: [],
      producer: { product: 'openplanr', version: '1.19.0', runtime: 'claude' },
    } as unknown as OperatingRoleResult;

    const gated = await gateRecordedProposalCitations({
      roleResults: [roleResult],
      context: fixture.context,
    });

    // Only the invalid proposal is dropped; the two valid ones survive.
    expect(gated.roleResults[0].proposals.map((proposal) => proposal.proposalKey).sort()).toEqual([
      'valid-planr',
      'valid-repo',
    ]);
    // The role grounded evidence, so it is never rendered not_evaluated.
    expect(gated.notEvaluatedRoleIds).not.toContain('strategy-finance');
    // The role's narrative survives the single bad reference untouched.
    expect((gated.roleResults[0] as unknown as { analysisMarkdown: string }).analysisMarkdown).toBe(
      analysisMarkdown,
    );
    // Exactly one governed unresolvable-citation gap, for the dropped proposal.
    expect(gated.gaps.filter((gap) => gap.category === 'unresolvable-citation')).toHaveLength(1);
    // Every surviving proposal carries its minted evidence.
    for (const proposal of gated.roleResults[0].proposals) {
      expect(proposal.evidenceRefs.length).toBeGreaterThan(0);
    }
  });

  it('fails a renamed planning artifact closed, naming the claim and expected kind without exposing content', async () => {
    const projectRoot = await initGitProject('openplanr-operate-citation-renamed-');
    await mkdir(join(projectRoot, '.planr', 'stories'), { recursive: true });
    await writeFile(
      join(projectRoot, '.planr', 'stories', 'US-001-old.md'),
      '# US-001 — Old\n\nSENSITIVE-BODY-MARKER must never surface in a validation error.\n',
    );
    await git(projectRoot, ['add', '-A']);
    await git(projectRoot, ['commit', '--quiet', '-m', 'first']);
    // Rename so the US-001 id no longer resolves at the pin (US-002 does).
    await git(projectRoot, ['mv', '.planr/stories/US-001-old.md', '.planr/stories/US-002-new.md']);
    await git(projectRoot, ['commit', '--quiet', '-m', 'rename artifact id']);
    const head = await git(projectRoot, ['rev-parse', 'HEAD']);

    const cache = await newCache();
    const context = contextFor(projectRoot, controlDescriptor(head), cache);
    const enforcement = await enforceProposalCitations(
      [
        {
          proposalKey: 'claim-cites-renamed',
          citations: [{ planrArtifactId: 'US-001', pinnedRevision: head }],
        },
      ],
      context,
    );

    expect(enforcement.accepted).toHaveLength(0);
    expect(enforcement.rejected).toHaveLength(1);
    // The error names the affected claim/action and the expected citation kind.
    expect(enforcement.rejected[0].proposalKey).toBe('claim-cites-renamed');
    expect(enforcement.rejected[0].expectedCitationKind).toBe('planr-artifact');
    expect(enforcement.rejected[0].reason).toBe('unresolvable');
    // Exactly one governed gap, naming the kind, exposing no cited content.
    expect(enforcement.gaps).toHaveLength(1);
    expect(enforcement.gaps[0].category).toBe('unresolvable-citation');
    expect(enforcement.gaps[0].question).toContain('planr-artifact');
    expect(JSON.stringify(enforcement.gaps[0])).not.toContain('SENSITIVE-BODY-MARKER');
  });

  it('mints a fresh evidence id for a renamed .planr/ slug at a new pin, never a stale cached snapshot', async () => {
    const projectRoot = await initGitProject('openplanr-operate-citation-rename-slug-');
    await mkdir(join(projectRoot, '.planr', 'stories'), { recursive: true });
    await writeFile(
      join(projectRoot, '.planr', 'stories', 'US-001-foo.md'),
      '# US-001\n\nPINNED-BODY-ALPHA\n',
    );
    await git(projectRoot, ['add', '-A']);
    await git(projectRoot, ['commit', '--quiet', '-m', 'first']);
    const pinOne = await git(projectRoot, ['rev-parse', 'HEAD']);
    // Rename the slug (same US-001 id) and change the body, at a new pin.
    await git(projectRoot, ['mv', '.planr/stories/US-001-foo.md', '.planr/stories/US-001-bar.md']);
    await writeFile(
      join(projectRoot, '.planr', 'stories', 'US-001-bar.md'),
      '# US-001\n\nPINNED-BODY-BETA\n',
    );
    await git(projectRoot, ['add', '-A']);
    await git(projectRoot, ['commit', '--quiet', '-m', 'rename slug and edit body']);
    const pinTwo = await git(projectRoot, ['rev-parse', 'HEAD']);

    const cache = await newCache();
    const first = await resolveOperatingCitationAtPin(
      { planrArtifactId: 'US-001', pinnedRevision: pinOne },
      contextFor(projectRoot, controlDescriptor(pinOne), cache),
    );
    const second = await resolveOperatingCitationAtPin(
      { planrArtifactId: 'US-001', pinnedRevision: pinTwo },
      contextFor(projectRoot, controlDescriptor(pinTwo), cache),
    );

    expect(first.outcome).toBe('resolved');
    expect(second.outcome).toBe('resolved');
    // A new pin yields a distinct evidence id: the cache key never maps a stale
    // path to new content.
    expect(second.evidenceId).not.toBe(first.evidenceId);
    const now = new Date('2026-07-31T00:00:00.000Z');
    const snapshotOne = await cache.getCitationSnapshot(first.evidenceId as string, now);
    const snapshotTwo = await cache.getCitationSnapshot(second.evidenceId as string, now);
    expect(snapshotOne?.content).toContain('PINNED-BODY-ALPHA');
    expect(snapshotOne?.content).not.toContain('PINNED-BODY-BETA');
    expect(snapshotTwo?.content).toContain('PINNED-BODY-BETA');
    expect(snapshotTwo?.sourceLocation).toBe('.planr/stories/US-001-bar.md');
  });

  it('rejects uncommitted-but-present working-tree content as dirty-working-tree, never fabricated-path', async () => {
    const projectRoot = await initGitProject('openplanr-operate-citation-dirty-');
    await mkdir(join(projectRoot, 'src'), { recursive: true });
    await writeFile(join(projectRoot, 'src', 'service.ts'), SERVICE_CONTENT);
    await git(projectRoot, ['add', '-A']);
    await git(projectRoot, ['commit', '--quiet', '-m', 'first']);
    const head = await git(projectRoot, ['rev-parse', 'HEAD']);
    // A real uncommitted file present in a dirty working tree.
    await writeFile(join(projectRoot, 'src', 'in-flight.ts'), 'export const inFlight = true;\n');
    const cache = await newCache();
    const context = contextFor(projectRoot, controlDescriptor(head, true), cache);

    const dirty = await resolveOperatingCitationAtPin(
      { repositoryPath: 'src/in-flight.ts', pinnedRevision: head },
      context,
    );
    expect(dirty.outcome).toBe('rejected');
    expect(dirty.reason).toBe('dirty-working-tree');
    expect(dirty.reason).not.toBe('fabricated-path');
    expect(dirty.expectedCitationKind).toBe('repo-path');

    // A path absent from both the pin and the working tree stays a fabricated path.
    const fabricated = await resolveOperatingCitationAtPin(
      { repositoryPath: 'src/never.ts', pinnedRevision: head },
      context,
    );
    expect(fabricated.reason).toBe('fabricated-path');
  });

  it("resolves a citation into a nested component repository against that component's own revision", async () => {
    const parentRoot = await initGitProject('openplanr-operate-citation-parent-');
    await writeFile(join(parentRoot, 'root.txt'), 'parent repository file\n');
    await git(parentRoot, ['add', '-A']);
    await git(parentRoot, ['commit', '--quiet', '-m', 'parent']);
    const parentHead = await git(parentRoot, ['rev-parse', 'HEAD']);

    // A nested component repository with its own independent history.
    const componentRoot = join(parentRoot, 'packages', 'widget');
    await mkdir(join(componentRoot, 'src'), { recursive: true });
    await git(componentRoot, ['init', '--quiet']);
    await git(componentRoot, ['config', 'user.name', 'OpenPlanr Test']);
    await git(componentRoot, ['config', 'user.email', 'test@openplanr.invalid']);
    await writeFile(join(componentRoot, 'src', 'widget.ts'), 'export const widget = 42;\n');
    await git(componentRoot, ['add', '-A']);
    await git(componentRoot, ['commit', '--quiet', '-m', 'component']);
    const componentHead = await git(componentRoot, ['rev-parse', 'HEAD']);
    expect(componentHead).not.toBe(parentHead);

    const cache = await newCache();
    const componentDescriptor: OperatingWorkspaceComponent = {
      componentId: 'widget',
      canonicalRemote: 'github.com/openplanr/widget',
      configuredBranch: 'main',
      pinnedRevision: componentHead,
      dirtyFingerprint: null,
      readOnly: true,
    };
    const componentContext = contextFor(componentRoot, componentDescriptor, cache);

    const resolved = await resolveOperatingCitationAtPin(
      {
        repositoryPath: 'src/widget.ts',
        lineRange: { start: 1, end: 1 },
        pinnedRevision: componentHead,
      },
      componentContext,
    );
    expect(resolved.outcome).toBe('resolved');
    expect(resolved.evidenceId).toMatch(/^EVD-/);
    const snapshot = await cache.getCitationSnapshot(
      resolved.evidenceId as string,
      componentContext.now,
    );
    expect(snapshot?.content).toContain('export const widget = 42;');

    // The same path against the parent's revision does not resolve — proving the
    // citation is audited against the component's own revision, not the parent's.
    const crossPinned = await resolveOperatingCitationAtPin(
      {
        repositoryPath: 'src/widget.ts',
        lineRange: { start: 1, end: 1 },
        pinnedRevision: parentHead,
      },
      contextFor(componentRoot, { ...componentDescriptor, pinnedRevision: parentHead }, cache),
    );
    expect(crossPinned.outcome).toBe('rejected');
    expect(crossPinned.reason).toBe('fabricated-path');
  });

  it('mints every resolved digest through the pipeline library, never hand-computing or rewriting it', async () => {
    const fixture = await buildFixture();
    const citation = {
      repositoryPath: 'src/service.ts',
      lineRange: { start: 1, end: 3 },
      pinnedRevision: fixture.head,
    };
    const resolved = await resolveOperatingCitationAtPin(citation, fixture.context);
    expect(resolved.outcome).toBe('resolved');

    // Reproduce the resolution through the installed pipeline library exactly the
    // way the resolver loads it, and assert the digest is byte-identical — proving
    // the module returns the library's snapshot binding rather than a hand-rolled
    // (e.g. content-hash) digest. This assertion pins the digest to the library
    // path, so a future change that reintroduced a hand-computed digest fails here.
    const pkg = resolvePipelinePackage(false);
    expect(pkg).not.toBeNull();
    const citationModule = (await import(
      pathToFileURL(join((pkg as { root: string }).root, 'lib', 'operate', 'citation.mjs')).href
    )) as {
      resolveOperatingCitation: (
        citation: unknown,
        facts: unknown,
      ) => { snapshotDigest: string; evidenceId: string };
    };
    const citationKey = `cite-${canonicalDigest(citation).slice('sha256:'.length, 34)}`;
    const keyed = { ...citation, citationKey };
    const facts = {
      sensitivity: 'internal',
      pathExistsAtRevision: true,
      lineRangeInBounds: true,
      revisionIsCurrent: true,
    };
    const library = citationModule.resolveOperatingCitation(keyed, facts);

    expect(resolved.snapshotDigest).toBe(library.snapshotDigest);
    expect(resolved.evidenceId).toBe(library.evidenceId);
    // The library's own derivation: evidenceId = EVD-<hex of snapshotDigest>.
    expect(resolved.evidenceId).toBe(
      `EVD-${(resolved.snapshotDigest as string).slice('sha256:'.length)}`,
    );
    // And it is NOT a hand-computed digest of the cited content bytes.
    expect(resolved.snapshotDigest).not.toBe(canonicalDigest(SERVICE_CONTENT));
  });
});
