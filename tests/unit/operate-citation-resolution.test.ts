import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { resolvePlanrArtifactCitation } from '../../src/services/operate/artifacts.js';
import {
  type CitationResolutionContext,
  enforceProposalCitations,
  resolveOperatingCitationAtPin,
} from '../../src/services/operate/citation-resolution.js';
import { OperatingEvidenceCache } from '../../src/services/operate/evidence-cache.js';
import { enforceRecordedProposalCitations } from '../../src/services/operate/interaction/action-service.js';
import type { OperatingWorkspaceComponent } from '../../src/services/operate/types.js';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

const SERVICE_CONTENT = 'export function add(a: number, b: number): number {\n  return a + b;\n}\n';
const SECRET_TOKEN = 'ghp_0123456789012345678901234567890123';
const SECRET_CONTENT = `export const githubToken = "${SECRET_TOKEN}";\n`;
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
  await writeFile(join(projectRoot, 'src', 'secrets.ts'), SECRET_CONTENT);
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

  it('redacts a secret in cited content so it never appears raw in the persisted snapshot', async () => {
    const fixture = await buildFixture();
    const resolved = await resolveOperatingCitationAtPin(
      {
        repositoryPath: 'src/secrets.ts',
        lineRange: { start: 1, end: 1 },
        pinnedRevision: fixture.head,
      },
      fixture.context,
    );
    expect(resolved.outcome).toBe('resolved');
    const snapshot = await fixture.cache.getCitationSnapshot(
      resolved.evidenceId as string,
      fixture.context.now,
    );
    expect(snapshot?.content).not.toContain(SECRET_TOKEN);
    expect(snapshot?.content).toContain('[REDACTED_TOKEN]');

    // No cache file on disk contains the raw secret bytes.
    for (const name of await readdir(fixture.cacheRoot)) {
      const raw = await readFile(join(fixture.cacheRoot, name), 'utf8');
      expect(raw).not.toContain(SECRET_TOKEN);
    }
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
