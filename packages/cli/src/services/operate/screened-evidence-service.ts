import { createHash } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { JsonRecord, ScreenedEvidenceResolverSource } from './composition.js';
import {
  readScreenedRepositoryText,
  resolveScreenedRepositoryFile,
} from './repository-read-service.js';

const MAX_EVIDENCE_BYTES = 128 * 1024;
const MAX_DIRECTORY_ENTRIES = 128;

const FILESYSTEM_SOURCES = Object.freeze([
  {
    sourceContract: 'repository-architecture' as const,
    sourceRootId: 'project-repository-architecture',
    paths: Object.freeze([
      'package.json',
      'tsconfig.json',
      'pyproject.toml',
      'Cargo.toml',
      'go.mod',
      'ARCHITECTURE.md',
      'docs/architecture.md',
      'docs/ARCHITECTURE.md',
    ]),
  },
  {
    sourceContract: 'ci-test-evidence' as const,
    sourceRootId: 'project-ci-test-evidence',
    paths: Object.freeze([
      '.github/workflows/ci.yml',
      '.github/workflows/ci.yaml',
      'vitest.config.ts',
      'vitest.config.mts',
      'pytest.ini',
    ]),
  },
]);

export type ScreenedEvidencePreparation = Readonly<{
  candidate: JsonRecord;
  source: ScreenedEvidenceResolverSource;
  relativePath: string;
  sourceContractId: 'repository-architecture' | 'planning-acceptance' | 'ci-test-evidence';
}>;

type Scope = Readonly<{ scopeId: string; domainId: string; domainVersion: string }>;

function sha256(text: string): string {
  return `sha256:${createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')}`;
}

function missing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

async function screenedText(projectDir: string, relativePath: string): Promise<string | null> {
  try {
    await resolveScreenedRepositoryFile(projectDir, relativePath);
    return await readScreenedRepositoryText(projectDir, relativePath, {
      maxBytes: MAX_EVIDENCE_BYTES,
    });
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

async function safeEntries(projectDir: string, relativeDirectory: string) {
  const absolute = path.join(projectDir, ...relativeDirectory.split('/'));
  try {
    const metadata = await lstat(absolute);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw Object.assign(
        new Error(`Screened evidence directory is not a real directory: ${relativeDirectory}`),
        {
          code: 'E_OPERATE_REPOSITORY_PATH_DENIED',
        },
      );
    }
    return (await readdir(absolute, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, MAX_DIRECTORY_ENTRIES);
  } catch (error) {
    if (missing(error)) return [];
    throw error;
  }
}

async function discoverPlanningPaths(projectDir: string): Promise<string[]> {
  const discovered: string[] = [];
  for (const entry of await safeEntries(projectDir, '.planr/specs')) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const directory = `.planr/specs/${entry.name}`;
    const document = (await safeEntries(projectDir, directory)).find(
      (candidate) => candidate.isFile() && /^SPEC-[0-9]+.*\.md$/u.test(candidate.name),
    );
    if (document) discovered.push(`${directory}/${document.name}`);
  }
  const story = (await safeEntries(projectDir, '.planr/stories')).find(
    (entry) => entry.isFile() && /-gherkin\.feature$/u.test(entry.name),
  );
  if (story) discovered.push(`.planr/stories/${story.name}`);
  return discovered.sort().slice(0, 2);
}

function filesystemCandidate(input: {
  candidateId: string;
  sourceArtifactId: string;
  scope: Scope;
  sourceRootId: string;
  relativePath: string;
}): JsonRecord {
  return {
    kind: 'operating-evidence-candidate',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    candidateId: input.candidateId,
    ...input.scope,
    sourceArtifactId: input.sourceArtifactId,
    evidenceKind: 'filesystem',
    locator: { sourceRootId: input.sourceRootId, path: input.relativePath },
    provider: { id: 'local-filesystem-evidence-provider', version: '2.0.0' },
    resolver: { id: 'local-filesystem-evidence-resolver', version: '2.0.0' },
  };
}

/**
 * Builds only adapter-owned Candidates for a tiny public-file allowlist. Callers supply
 * scope and runtime IDs, never source contracts, capabilities, roots, or arbitrary paths.
 */
export async function prepareScreenedOperateEvidence(input: {
  projectDir: string;
  scope: Scope;
  sourceArtifactId: string;
  issueCandidateId: () => string;
}): Promise<readonly ScreenedEvidencePreparation[]> {
  const projectDir = path.resolve(input.projectDir);
  const prepared: ScreenedEvidencePreparation[] = [];
  for (const source of FILESYSTEM_SOURCES) {
    for (const relativePath of source.paths) {
      if ((await screenedText(projectDir, relativePath)) === null) continue;
      const resolverSource: ScreenedEvidenceResolverSource = {
        kind: 'filesystem',
        sourceRootId: source.sourceRootId,
        rootPath: projectDir,
        maxBytes: MAX_EVIDENCE_BYTES,
        classification: 'internal',
        sourceContract: { id: source.sourceContract, version: '1.0.0' },
      };
      prepared.push({
        candidate: filesystemCandidate({
          candidateId: input.issueCandidateId(),
          sourceArtifactId: input.sourceArtifactId,
          scope: input.scope,
          sourceRootId: source.sourceRootId,
          relativePath,
        }),
        source: resolverSource,
        relativePath,
        sourceContractId: source.sourceContract,
      });
    }
  }

  let artifactIndex = 0;
  for (const relativePath of await discoverPlanningPaths(projectDir)) {
    const text = await screenedText(projectDir, relativePath);
    if (text === null) continue;
    artifactIndex += 1;
    const artifactId = `planning-acceptance-${artifactIndex}`;
    const contentHash = sha256(text);
    const source: ScreenedEvidenceResolverSource = {
      kind: 'planr',
      projectId: 'screened-planr-project',
      rootPath: projectDir,
      maxBytes: MAX_EVIDENCE_BYTES,
      classification: 'internal',
      scope: input.scope,
      sourceContract: { id: 'planning-acceptance', version: '1.0.0' },
      artifacts: [
        {
          artifactId,
          artifactType: 'planning-artifact',
          path: relativePath,
          contentHash,
        },
      ],
    };
    prepared.push({
      candidate: {
        kind: 'operating-evidence-candidate',
        schemaVersion: '1.0.0',
        protocolVersion: '2.0.0',
        candidateId: input.issueCandidateId(),
        ...input.scope,
        sourceArtifactId: input.sourceArtifactId,
        evidenceKind: 'planr',
        locator: {
          projectId: source.projectId,
          artifactId,
          artifactType: 'planning-artifact',
          path: relativePath,
          contentHash,
        },
        provider: { id: 'local-planr-evidence-provider', version: '2.0.0' },
        resolver: { id: 'local-planr-evidence-resolver', version: '2.0.0' },
      },
      source,
      relativePath,
      sourceContractId: 'planning-acceptance',
    });
  }
  return Object.freeze(prepared);
}
