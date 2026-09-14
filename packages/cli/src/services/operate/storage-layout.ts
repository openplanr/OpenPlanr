import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { assertOperatePathCustody } from './path-custody.js';
import { runPinnedLegacyReplayVerifier } from './pinned-legacy-replay-runner.js';
import { OperateStore } from './store.js';

const PRIVATE_IGNORE_ENTRIES = ['/state/', '/packets/', '/archive/'] as const;
const LEGACY_OPERATE_DIRECTORY = 'operate-v2';
const MIGRATION_PROGRESS_FILE = '.migration-in-progress.json';
const PRE_SPEC_024_PRODUCT_VERSION = '1.25.3+git.7859e52dd89f';
const PRE_SPEC_024_PIPELINE_VERSION = '0.42.0+git.d6bcb5574aaf';

export type OperateStorageInspection = Readonly<{
  status: 'empty' | 'ready' | 'migration-required' | 'interrupted';
  root: string;
  legacyV2Root: string | null;
  legacyNeutralRoot: string | null;
  privatePaths: readonly string[];
  interruptedEntries: readonly string[];
}>;

export type OperateStorageArchive = Readonly<{
  archiveId: string;
  source: 'operate-v2' | 'operate-legacy';
  hash: string;
  fileCount: number;
}>;

export type OperateStorageMigrationReceipt = Readonly<{
  kind: 'operate-storage-migration-receipt';
  migrated: boolean;
  archives: readonly OperateStorageArchive[];
  verificationProofHash: string | null;
}>;

export type OperateLegacyReplayProof = Readonly<{
  kind: 'operate-legacy-replay-proof';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  source: 'operate-v2';
  projectFingerprint: string;
  tree: TreeDigest;
  replay: Readonly<{
    currentGeneration: string;
    stateCanonicalHash: string;
    eventHead: Readonly<{ sequence: number; hash: string | null }>;
    artifactHashes: readonly Readonly<{ artifactId: string; rawHash: string }>[];
  }>;
  verifier: Readonly<{
    product: 'openplanr';
    productVersion: string;
    pipelinePackage: 'planr-pipeline';
    pipelineVersion: string;
  }>;
  verifiedAt: string;
  receiptHash: string;
}>;

type TreeDigest = Readonly<{ hash: string; fileCount: number }>;
type TreeModes = ReadonlyMap<string, number>;
type MigrationProgress = Readonly<{
  kind: 'operate-storage-migration-progress';
  schemaVersion: '1.0.0';
  nonce: string;
  stamp: string;
  verificationProofHash: string | null;
  sources: readonly Readonly<{
    source: 'operate-v2' | 'operate-legacy';
    hash: string;
    fileCount: number;
    archiveId: string;
  }>[];
}>;

async function projectFingerprint(projectDir: string): Promise<string> {
  const canonicalProject = await realpath(path.resolve(projectDir));
  return `sha256:${createHash('sha256')
    .update(`openplanr-operate-project\0${canonicalProject}`)
    .digest('hex')}`;
}

function legacyProofPayload(proof: Omit<OperateLegacyReplayProof, 'receiptHash'>): string {
  return JSON.stringify({
    kind: proof.kind,
    schemaVersion: proof.schemaVersion,
    protocolVersion: proof.protocolVersion,
    source: proof.source,
    projectFingerprint: proof.projectFingerprint,
    tree: { hash: proof.tree.hash, fileCount: proof.tree.fileCount },
    replay: {
      currentGeneration: proof.replay.currentGeneration,
      stateCanonicalHash: proof.replay.stateCanonicalHash,
      eventHead: { sequence: proof.replay.eventHead.sequence, hash: proof.replay.eventHead.hash },
      artifactHashes: proof.replay.artifactHashes.map(({ artifactId, rawHash }) => ({
        artifactId,
        rawHash,
      })),
    },
    verifier: {
      product: proof.verifier.product,
      productVersion: proof.verifier.productVersion,
      pipelinePackage: proof.verifier.pipelinePackage,
      pipelineVersion: proof.verifier.pipelineVersion,
    },
    verifiedAt: proof.verifiedAt,
  });
}

function legacyProofHash(proof: Omit<OperateLegacyReplayProof, 'receiptHash'>): string {
  return `sha256:${createHash('sha256').update(legacyProofPayload(proof)).digest('hex')}`;
}

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink()) {
      throw Object.assign(new Error('Operate storage custody cannot be a symbolic link.'), {
        code: 'OPERATE_STORE_INCOMPATIBLE',
      });
    }
    return metadata.isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function atomicWrite(projectDir: string, target: string, content: string): Promise<void> {
  await assertOperatePathCustody(projectDir, target, {
    code: 'OPERATE_STORE_INCOMPATIBLE',
    message: 'Operate storage writes cannot traverse symbolic links.',
  });
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await assertOperatePathCustody(projectDir, path.dirname(target), {
    code: 'OPERATE_STORE_INCOMPATIBLE',
    message: 'Operate storage writes cannot traverse symbolic links.',
    requireDirectory: true,
  });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
  await rename(temporary, target);
  await assertOperatePathCustody(projectDir, target, {
    code: 'OPERATE_STORE_INCOMPATIBLE',
    message: 'Operate storage writes cannot traverse symbolic links.',
    requireFile: true,
  });
}

async function ensureIgnoreFile(projectDir: string, target: string): Promise<void> {
  await assertOperatePathCustody(projectDir, target, {
    code: 'OPERATE_STORE_INCOMPATIBLE',
    message: 'Operate ignore-file custody cannot traverse symbolic links.',
  });
  let existing = '';
  try {
    existing = await readFile(target, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const lines = existing.split(/\r?\n/u).filter(Boolean);
  for (const entry of PRIVATE_IGNORE_ENTRIES) {
    if (!lines.includes(entry)) lines.push(entry);
  }
  const next = `${lines.join('\n')}\n`;
  if (next !== existing) await atomicWrite(projectDir, target, next);
}

async function createLayout(projectDir: string, root: string): Promise<void> {
  await assertOperatePathCustody(projectDir, root, {
    code: 'OPERATE_STORE_INCOMPATIBLE',
    message: 'Operate storage layout cannot traverse symbolic links.',
  });
  await Promise.all(
    ['state', 'packets', 'projections', 'archive'].map(
      async (directory) =>
        await mkdir(path.join(root, directory), { recursive: true, mode: 0o700 }),
    ),
  );
  for (const directory of [
    root,
    ...['state', 'packets', 'projections', 'archive'].map((entry) => path.join(root, entry)),
  ]) {
    await assertOperatePathCustody(projectDir, directory, {
      code: 'OPERATE_STORE_INCOMPATIBLE',
      message: 'Operate storage layout cannot traverse symbolic links.',
      requireDirectory: true,
    });
  }
  await Promise.all(
    [root, 'state', 'packets', 'projections', 'archive'].map(
      async (directory) =>
        await chmod(directory === root ? root : path.join(root, directory), 0o700),
    ),
  );
  await ensureIgnoreFile(projectDir, path.join(root, '.gitignore'));
  await ensureIgnoreFile(projectDir, path.join(root, '.ignore'));
}

async function isCurrentLayout(root: string): Promise<boolean> {
  return (
    (await isDirectory(path.join(root, 'state'))) &&
    (await isDirectory(path.join(root, 'packets'))) &&
    (await isDirectory(path.join(root, 'projections'))) &&
    (await isDirectory(path.join(root, 'archive')))
  );
}

async function digestTree(root: string): Promise<TreeDigest> {
  const rootMetadata = await lstat(root);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw Object.assign(new Error('Operate storage tree custody must be one real directory.'), {
      code: 'OPERATE_STORE_INCOMPATIBLE',
    });
  }
  const records: Array<{ path: string; hash: string; size: number }> = [];
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink()) {
        throw Object.assign(new Error(`Operate storage contains a symbolic link: ${relative}`), {
          code: 'OPERATE_STORE_INCOMPATIBLE',
        });
      }
      if (metadata.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!metadata.isFile()) {
        throw Object.assign(
          new Error(`Operate storage contains an unsupported entry: ${relative}`),
          {
            code: 'OPERATE_STORE_INCOMPATIBLE',
          },
        );
      }
      const bytes = await readFile(absolute);
      records.push({
        path: relative,
        hash: createHash('sha256').update(bytes).digest('hex'),
        size: bytes.byteLength,
      });
    }
  };
  await walk(root);
  return {
    hash: `sha256:${createHash('sha256').update(JSON.stringify(records)).digest('hex')}`,
    fileCount: records.length,
  };
}

async function privatizeTree(root: string): Promise<void> {
  const walk = async (target: string): Promise<void> => {
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink()) {
      throw Object.assign(new Error('Operate archive custody cannot contain symbolic links.'), {
        code: 'OPERATE_STORE_INCOMPATIBLE',
      });
    }
    if (metadata.isDirectory()) {
      await chmod(target, 0o700);
      for (const entry of await readdir(target)) await walk(path.join(target, entry));
      return;
    }
    if (!metadata.isFile()) {
      throw Object.assign(new Error('Operate archive custody contains an unsupported entry.'), {
        code: 'OPERATE_STORE_INCOMPATIBLE',
      });
    }
    await chmod(target, 0o600);
  };
  await walk(root);
}

async function captureTreeModes(root: string): Promise<TreeModes> {
  const modes = new Map<string, number>();
  const walk = async (target: string): Promise<void> => {
    const metadata = await lstat(target);
    if (!metadata.isDirectory() && !metadata.isFile()) {
      throw Object.assign(
        new Error('Operate storage contains an unsupported mode-bearing entry.'),
        {
          code: 'OPERATE_STORE_INCOMPATIBLE',
        },
      );
    }
    modes.set(path.relative(root, target), metadata.mode & 0o777);
    if (metadata.isDirectory()) {
      for (const entry of await readdir(target)) await walk(path.join(target, entry));
    }
  };
  await walk(root);
  return modes;
}

async function restoreTreeModes(root: string, modes: TreeModes): Promise<void> {
  const entries = [...modes.entries()].sort(
    ([left], [right]) => right.split(path.sep).length - left.split(path.sep).length,
  );
  for (const [relative, mode] of entries) await chmod(path.join(root, relative), mode);
}

async function assertLegacyReplayProof(
  projectDir: string,
  value: unknown,
  expectedTree: TreeDigest,
): Promise<OperateLegacyReplayProof> {
  const proof =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const exactKeys = [
    'kind',
    'schemaVersion',
    'protocolVersion',
    'source',
    'projectFingerprint',
    'tree',
    'replay',
    'verifier',
    'verifiedAt',
    'receiptHash',
  ].sort();
  const tree =
    proof.tree !== null && typeof proof.tree === 'object' && !Array.isArray(proof.tree)
      ? (proof.tree as Record<string, unknown>)
      : {};
  const replay =
    proof.replay !== null && typeof proof.replay === 'object' && !Array.isArray(proof.replay)
      ? (proof.replay as Record<string, unknown>)
      : {};
  const eventHead =
    replay.eventHead !== null &&
    typeof replay.eventHead === 'object' &&
    !Array.isArray(replay.eventHead)
      ? (replay.eventHead as Record<string, unknown>)
      : {};
  const verifier =
    proof.verifier !== null && typeof proof.verifier === 'object' && !Array.isArray(proof.verifier)
      ? (proof.verifier as Record<string, unknown>)
      : {};
  const artifacts = Array.isArray(replay.artifactHashes) ? replay.artifactHashes : [];
  if (
    JSON.stringify(Object.keys(proof).sort()) !== JSON.stringify(exactKeys) ||
    proof.kind !== 'operate-legacy-replay-proof' ||
    proof.schemaVersion !== '1.0.0' ||
    proof.protocolVersion !== '2.0.0' ||
    proof.source !== 'operate-v2' ||
    proof.projectFingerprint !== (await projectFingerprint(projectDir)) ||
    JSON.stringify(Object.keys(tree).sort()) !== JSON.stringify(['fileCount', 'hash']) ||
    tree.hash !== expectedTree.hash ||
    tree.fileCount !== expectedTree.fileCount ||
    JSON.stringify(Object.keys(replay).sort()) !==
      JSON.stringify(['artifactHashes', 'currentGeneration', 'eventHead', 'stateCanonicalHash']) ||
    typeof replay.currentGeneration !== 'string' ||
    replay.currentGeneration.length === 0 ||
    typeof replay.stateCanonicalHash !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/u.test(replay.stateCanonicalHash) ||
    JSON.stringify(Object.keys(eventHead).sort()) !== JSON.stringify(['hash', 'sequence']) ||
    !Number.isInteger(eventHead.sequence) ||
    Number(eventHead.sequence) < 0 ||
    (Number(eventHead.sequence) === 0
      ? eventHead.hash !== null
      : typeof eventHead.hash !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(eventHead.hash)) ||
    JSON.stringify(Object.keys(verifier).sort()) !==
      JSON.stringify(['pipelinePackage', 'pipelineVersion', 'product', 'productVersion']) ||
    verifier.product !== 'openplanr' ||
    verifier.pipelinePackage !== 'planr-pipeline' ||
    verifier.productVersion !== PRE_SPEC_024_PRODUCT_VERSION ||
    verifier.pipelineVersion !== PRE_SPEC_024_PIPELINE_VERSION ||
    typeof proof.verifiedAt !== 'string' ||
    Number.isNaN(Date.parse(proof.verifiedAt)) ||
    typeof proof.receiptHash !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/u.test(proof.receiptHash)
  ) {
    throw Object.assign(new Error('Legacy Operate replay proof is malformed, stale, or foreign.'), {
      code: 'OPERATE_STORE_INCOMPATIBLE',
    });
  }
  let priorArtifactId = '';
  const normalizedArtifacts = artifacts.map((candidate) => {
    const artifact =
      candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate)
        ? (candidate as Record<string, unknown>)
        : {};
    if (
      JSON.stringify(Object.keys(artifact).sort()) !== JSON.stringify(['artifactId', 'rawHash']) ||
      typeof artifact.artifactId !== 'string' ||
      artifact.artifactId.length === 0 ||
      artifact.artifactId <= priorArtifactId ||
      typeof artifact.rawHash !== 'string' ||
      !/^sha256:[a-f0-9]{64}$/u.test(artifact.rawHash)
    ) {
      throw Object.assign(new Error('Legacy Operate replay proof has invalid Artifact hashes.'), {
        code: 'OPERATE_STORE_INCOMPATIBLE',
      });
    }
    priorArtifactId = artifact.artifactId;
    return Object.freeze({ artifactId: artifact.artifactId, rawHash: artifact.rawHash });
  });
  const unsigned = Object.freeze({
    kind: 'operate-legacy-replay-proof' as const,
    schemaVersion: '1.0.0' as const,
    protocolVersion: '2.0.0' as const,
    source: 'operate-v2' as const,
    projectFingerprint: proof.projectFingerprint as string,
    tree: Object.freeze({ hash: tree.hash as string, fileCount: tree.fileCount as number }),
    replay: Object.freeze({
      currentGeneration: replay.currentGeneration as string,
      stateCanonicalHash: replay.stateCanonicalHash as string,
      eventHead: Object.freeze({
        sequence: eventHead.sequence as number,
        hash: eventHead.hash as string | null,
      }),
      artifactHashes: Object.freeze(normalizedArtifacts),
    }),
    verifier: Object.freeze({
      product: 'openplanr' as const,
      productVersion: verifier.productVersion as string,
      pipelinePackage: 'planr-pipeline' as const,
      pipelineVersion: verifier.pipelineVersion as string,
    }),
    verifiedAt: proof.verifiedAt as string,
  });
  if (proof.receiptHash !== legacyProofHash(unsigned)) {
    throw Object.assign(
      new Error('Legacy Operate replay proof integrity does not match its exact bytes.'),
      {
        code: 'OPERATE_STORE_INCOMPATIBLE',
      },
    );
  }
  return Object.freeze({ ...unsigned, receiptHash: proof.receiptHash });
}

/**
 * Rechecks a pre-change verifier receipt against exact current custody without
 * activating, moving, or interpreting any legacy accepted result bytes.
 */
export async function verifyOperateLegacyReplayProof(
  projectDir: string,
  value: unknown,
): Promise<OperateLegacyReplayProof> {
  const legacyRoot = path.join(path.resolve(projectDir), '.planr', LEGACY_OPERATE_DIRECTORY);
  await assertOperatePathCustody(projectDir, legacyRoot, {
    code: 'OPERATE_STORE_INCOMPATIBLE',
    message: 'Legacy Operate proof custody cannot traverse symbolic links.',
    requireDirectory: true,
  });
  if (!(await isDirectory(legacyRoot))) {
    throw Object.assign(
      new Error('No legacy Operate 2.0 Store is available for proof verification.'),
      {
        code: 'OPERATE_STORE_INCOMPATIBLE',
      },
    );
  }
  const proof = await assertLegacyReplayProof(projectDir, value, await digestTree(legacyRoot));
  await new OperateStore(projectDir, { root: legacyRoot }).verifyReplayProofCustody(proof.replay);
  return proof;
}

function assertMigrationProgress(value: unknown): MigrationProgress {
  const input =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const keys = Object.keys(input).sort();
  if (
    JSON.stringify(keys) !==
      JSON.stringify([
        'kind',
        'nonce',
        'schemaVersion',
        'sources',
        'stamp',
        'verificationProofHash',
      ]) ||
    input.kind !== 'operate-storage-migration-progress' ||
    input.schemaVersion !== '1.0.0' ||
    typeof input.nonce !== 'string' ||
    !/^[a-f0-9]{32}$/u.test(input.nonce) ||
    typeof input.stamp !== 'string' ||
    (input.verificationProofHash !== null &&
      (typeof input.verificationProofHash !== 'string' ||
        !/^sha256:[a-f0-9]{64}$/u.test(input.verificationProofHash))) ||
    !Array.isArray(input.sources) ||
    input.sources.length < 1 ||
    input.sources.length > 2
  ) {
    throw Object.assign(new Error('Interrupted Operate migration progress is invalid.'), {
      code: 'OPERATE_STORE_CORRUPT',
    });
  }
  const seen = new Set<string>();
  const sources = input.sources.map((candidate) => {
    const source =
      candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate)
        ? (candidate as Record<string, unknown>)
        : {};
    if (
      JSON.stringify(Object.keys(source).sort()) !==
        JSON.stringify(['archiveId', 'fileCount', 'hash', 'source']) ||
      !['operate-v2', 'operate-legacy'].includes(String(source.source)) ||
      typeof source.hash !== 'string' ||
      !/^sha256:[a-f0-9]{64}$/u.test(source.hash) ||
      !Number.isInteger(source.fileCount) ||
      Number(source.fileCount) < 0 ||
      typeof source.archiveId !== 'string' ||
      source.archiveId !== `${input.stamp}-${source.source}` ||
      seen.has(String(source.source))
    ) {
      throw Object.assign(new Error('Interrupted Operate migration source custody is invalid.'), {
        code: 'OPERATE_STORE_CORRUPT',
      });
    }
    seen.add(String(source.source));
    return Object.freeze({
      source: source.source as 'operate-v2' | 'operate-legacy',
      hash: source.hash,
      fileCount: Number(source.fileCount),
      archiveId: source.archiveId,
    });
  });
  return Object.freeze({
    kind: 'operate-storage-migration-progress',
    schemaVersion: '1.0.0',
    nonce: input.nonce,
    stamp: input.stamp,
    verificationProofHash: input.verificationProofHash as string | null,
    sources: Object.freeze(sources),
  });
}

async function readMigrationProgress(
  projectDir: string,
  root: string,
): Promise<MigrationProgress | null> {
  await assertOperatePathCustody(projectDir, path.join(root, 'archive', MIGRATION_PROGRESS_FILE), {
    code: 'OPERATE_STORE_INCOMPATIBLE',
    message: 'Operate migration progress cannot traverse symbolic links.',
  });
  try {
    return assertMigrationProgress(
      JSON.parse(
        await readFile(path.join(root, 'archive', MIGRATION_PROGRESS_FILE), 'utf8'),
      ) as unknown,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    if (error instanceof SyntaxError) {
      throw Object.assign(new Error('Interrupted Operate migration progress is not valid JSON.'), {
        code: 'OPERATE_STORE_CORRUPT',
      });
    }
    throw error;
  }
}

async function recoverPreActivationMigration(
  projectDir: string,
  onArchive?: (archive: OperateStorageArchive) => Promise<void>,
): Promise<OperateStorageMigrationReceipt> {
  const planrRoot = path.join(path.resolve(projectDir), '.planr');
  const entries = await readdir(planrRoot, { withFileTypes: true });
  const stageEntries = entries
    .filter((entry) => entry.isDirectory() && /^\.operate-stage-[a-f0-9]+$/u.test(entry.name))
    .map((entry) => entry.name);
  const parkedEntries = entries
    .filter((entry) => entry.isDirectory() && /^\.operate-legacy-[a-f0-9]+$/u.test(entry.name))
    .map((entry) => entry.name);
  if (stageEntries.length !== 1 || parkedEntries.length > 1) {
    throw Object.assign(new Error('Interrupted Operate migration staging custody is ambiguous.'), {
      code: 'OPERATE_STORE_INCOMPATIBLE',
    });
  }
  const match = /^\.operate-stage-([a-f0-9]{32})$/u.exec(stageEntries[0]);
  if (!match) {
    throw Object.assign(new Error('Interrupted Operate migration staging identity is invalid.'), {
      code: 'OPERATE_STORE_INCOMPATIBLE',
    });
  }
  const nonce = match[1];
  const staging = path.join(planrRoot, stageEntries[0]);
  const root = path.join(planrRoot, 'operate');
  const parkedNeutral = path.join(planrRoot, `.operate-legacy-${nonce}`);
  for (const candidate of [
    staging,
    root,
    parkedNeutral,
    path.join(planrRoot, LEGACY_OPERATE_DIRECTORY),
  ]) {
    await assertOperatePathCustody(projectDir, candidate, {
      code: 'OPERATE_STORE_INCOMPATIBLE',
      message: 'Interrupted Operate migration custody cannot traverse symbolic links.',
    });
  }
  if (parkedEntries.length === 1 && parkedEntries[0] !== path.basename(parkedNeutral)) {
    throw Object.assign(new Error('Interrupted Operate parked custody does not match staging.'), {
      code: 'OPERATE_STORE_INCOMPATIBLE',
    });
  }
  if (!(await isCurrentLayout(staging))) {
    throw Object.assign(new Error('Interrupted Operate staging layout is incomplete.'), {
      code: 'OPERATE_STORE_CORRUPT',
    });
  }
  const progress = await readMigrationProgress(projectDir, staging);
  if (!progress || progress.nonce !== nonce) {
    throw Object.assign(new Error('Interrupted Operate staging progress is missing or foreign.'), {
      code: 'OPERATE_STORE_CORRUPT',
    });
  }
  const neutralSource = progress.sources.find(({ source }) => source === 'operate-legacy');
  const v2Source = progress.sources.find(({ source }) => source === 'operate-v2');
  const rootExists = await exists(root);
  const parkedExists = await exists(parkedNeutral);
  if (
    (neutralSource === undefined && (rootExists || parkedExists)) ||
    (neutralSource !== undefined && !rootExists && !parkedExists) ||
    (rootExists && parkedExists)
  ) {
    throw Object.assign(
      new Error('Interrupted Operate neutral custody is incomplete or ambiguous.'),
      {
        code: 'OPERATE_STORE_CORRUPT',
      },
    );
  }
  const assertSourceDigest = async (
    sourcePath: string,
    source: MigrationProgress['sources'][number],
  ): Promise<void> => {
    const digest = await digestTree(sourcePath);
    if (digest.hash !== source.hash || digest.fileCount !== source.fileCount) {
      throw Object.assign(
        new Error(`Interrupted ${source.source} custody changed before activation.`),
        {
          code: 'OPERATE_STORE_CORRUPT',
        },
      );
    }
  };
  if (neutralSource) {
    await assertSourceDigest(rootExists ? root : parkedNeutral, neutralSource);
  }
  if (v2Source) {
    const legacyV2Root = path.join(planrRoot, LEGACY_OPERATE_DIRECTORY);
    if (!(await exists(legacyV2Root))) {
      throw Object.assign(
        new Error('Interrupted legacy 2.0 custody is missing before activation.'),
        {
          code: 'OPERATE_STORE_CORRUPT',
        },
      );
    }
    await assertSourceDigest(legacyV2Root, v2Source);
  }

  let parkedDuringRecovery = false;
  if (neutralSource && rootExists) {
    await rename(root, parkedNeutral);
    parkedDuringRecovery = true;
  }
  try {
    await rename(staging, root);
  } catch (error) {
    if (parkedDuringRecovery && (await exists(parkedNeutral)) && !(await exists(root))) {
      await rename(parkedNeutral, root);
    }
    throw error;
  }
  return await completeInterruptedMigration(projectDir, progress, onArchive);
}

async function completeInterruptedMigration(
  projectDir: string,
  progress: MigrationProgress,
  onArchive?: (archive: OperateStorageArchive) => Promise<void>,
): Promise<OperateStorageMigrationReceipt> {
  const planrRoot = path.join(path.resolve(projectDir), '.planr');
  const root = path.join(planrRoot, 'operate');
  const parkedNeutral = path.join(planrRoot, `.operate-legacy-${progress.nonce}`);
  const archives: OperateStorageArchive[] = [];
  await assertOperatePathCustody(projectDir, root, {
    code: 'OPERATE_STORE_INCOMPATIBLE',
    message: 'Interrupted Operate migration root cannot traverse symbolic links.',
    requireDirectory: true,
  });
  for (const source of progress.sources) {
    const archivePath = path.join(root, 'archive', source.archiveId);
    if (!(await exists(archivePath))) {
      const sourcePath =
        source.source === 'operate-v2'
          ? path.join(planrRoot, LEGACY_OPERATE_DIRECTORY)
          : parkedNeutral;
      if (!(await exists(sourcePath))) {
        throw Object.assign(new Error(`Interrupted ${source.source} custody is missing.`), {
          code: 'OPERATE_STORE_CORRUPT',
        });
      }
      await rename(sourcePath, archivePath);
    }
    await privatizeTree(archivePath);
    const digest = await digestTree(archivePath);
    if (digest.hash !== source.hash || digest.fileCount !== source.fileCount) {
      throw Object.assign(
        new Error(`Interrupted ${source.source} custody changed before recovery.`),
        {
          code: 'OPERATE_STORE_CORRUPT',
        },
      );
    }
    const archive = Object.freeze({
      archiveId: source.archiveId,
      source: source.source,
      ...digest,
    });
    archives.push(archive);
    await onArchive?.(archive);
  }
  const receipt = Object.freeze({
    kind: 'operate-storage-migration-receipt' as const,
    migrated: true,
    archives: Object.freeze(archives),
    verificationProofHash: progress.verificationProofHash,
  });
  await atomicWrite(
    projectDir,
    path.join(root, 'archive', `${progress.stamp}-migration-receipt.json`),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  await rm(path.join(root, 'archive', MIGRATION_PROGRESS_FILE), { force: true });
  return receipt;
}

export async function inspectOperateStorage(projectDir: string): Promise<OperateStorageInspection> {
  const planrRoot = path.join(path.resolve(projectDir), '.planr');
  const root = path.join(planrRoot, 'operate');
  const legacyV2Root = path.join(planrRoot, LEGACY_OPERATE_DIRECTORY);
  for (const candidate of [planrRoot, root, legacyV2Root]) {
    await assertOperatePathCustody(projectDir, candidate, {
      code: 'OPERATE_STORE_INCOMPATIBLE',
      message: 'Operate storage inspection cannot traverse symbolic links.',
    });
  }
  const neutralExists = await exists(root);
  const current = neutralExists && (await isCurrentLayout(root));
  const oldV2 = await exists(legacyV2Root);
  const progress = current ? await readMigrationProgress(projectDir, root) : null;
  const planrEntries = await readdir(planrRoot, { withFileTypes: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  });
  const interruptedCandidates = planrEntries.filter(
    (entry) =>
      /^\.operate-stage-[a-f0-9-]+$/u.test(entry.name) ||
      /^\.operate-legacy-[a-f0-9-]+$/u.test(entry.name),
  );
  for (const entry of interruptedCandidates) {
    await assertOperatePathCustody(projectDir, path.join(planrRoot, entry.name), {
      code: 'OPERATE_STORE_INCOMPATIBLE',
      message: 'Interrupted Operate migration custody cannot traverse symbolic links.',
      requireDirectory: true,
    });
  }
  const interruptedEntries = interruptedCandidates.map((entry) => entry.name).sort();
  if (progress) interruptedEntries.push(`operate/archive/${MIGRATION_PROGRESS_FILE}`);
  return Object.freeze({
    status:
      interruptedEntries.length > 0
        ? 'interrupted'
        : current && !oldV2
          ? 'ready'
          : neutralExists || oldV2
            ? 'migration-required'
            : 'empty',
    root,
    legacyV2Root: oldV2 ? legacyV2Root : null,
    legacyNeutralRoot: neutralExists && (!current || oldV2) ? root : null,
    privatePaths: Object.freeze(
      PRIVATE_IGNORE_ENTRIES.map((entry) => path.join(root, entry.slice(1))),
    ),
    interruptedEntries: Object.freeze(interruptedEntries),
  });
}

export async function ensureOperateStorageLayout(projectDir: string): Promise<string> {
  const inspection = await inspectOperateStorage(projectDir);
  if (inspection.status === 'migration-required' || inspection.status === 'interrupted') {
    throw Object.assign(
      new Error(
        'Existing Operate storage must be replay-verified and archived before this runtime can start.',
      ),
      { code: 'OPERATE_STORE_INCOMPATIBLE' },
    );
  }
  await createLayout(projectDir, inspection.root);
  return inspection.root;
}

export async function migrateOperateStorage(
  projectDir: string,
  options: {
    now?: Date;
    onArchive?: (archive: OperateStorageArchive) => Promise<void>;
    afterStagePrepared?: () => Promise<void>;
    afterParkNeutral?: () => Promise<void>;
    afterActivate?: () => Promise<void>;
  } = {},
): Promise<OperateStorageMigrationReceipt> {
  const inspection = await inspectOperateStorage(projectDir);
  if (inspection.status === 'interrupted') {
    const progress = await readMigrationProgress(projectDir, inspection.root);
    if (progress) {
      return await completeInterruptedMigration(projectDir, progress, options.onArchive);
    }
    return await recoverPreActivationMigration(projectDir, options.onArchive);
  }
  if (inspection.status === 'ready') {
    return Object.freeze({
      kind: 'operate-storage-migration-receipt',
      migrated: false,
      archives: [],
      verificationProofHash: null,
    });
  }
  if (inspection.status === 'empty') {
    await createLayout(projectDir, inspection.root);
    return Object.freeze({
      kind: 'operate-storage-migration-receipt',
      migrated: false,
      archives: [],
      verificationProofHash: null,
    });
  }

  const sources = (
    await Promise.all([
      inspection.legacyV2Root
        ? Promise.all([
            digestTree(inspection.legacyV2Root),
            captureTreeModes(inspection.legacyV2Root),
          ]).then(([digest, modes]) => ({
            source: 'operate-v2' as const,
            path: inspection.legacyV2Root as string,
            digest,
            modes,
          }))
        : null,
      inspection.legacyNeutralRoot
        ? Promise.all([
            digestTree(inspection.legacyNeutralRoot),
            captureTreeModes(inspection.legacyNeutralRoot),
          ]).then(([digest, modes]) => ({
            source: 'operate-legacy' as const,
            path: inspection.legacyNeutralRoot as string,
            digest,
            modes,
          }))
        : null,
    ])
  ).filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  let verificationProofHash: string | null = null;
  if (inspection.legacyV2Root) {
    const proof = await verifyOperateLegacyReplayProof(
      projectDir,
      await runPinnedLegacyReplayVerifier(projectDir),
    );
    verificationProofHash = proof.receiptHash;
  }

  const planrRoot = path.dirname(inspection.root);
  const nonce = randomUUID().replaceAll('-', '');
  const staging = path.join(planrRoot, `.operate-stage-${nonce}`);
  const parkedNeutral = path.join(planrRoot, `.operate-legacy-${nonce}`);
  await createLayout(projectDir, staging);
  const stamp = (options.now ?? new Date()).toISOString().replaceAll(':', '-');
  const progress: MigrationProgress = Object.freeze({
    kind: 'operate-storage-migration-progress',
    schemaVersion: '1.0.0',
    nonce,
    stamp,
    verificationProofHash,
    sources: Object.freeze(
      sources.map((entry) =>
        Object.freeze({
          source: entry.source,
          hash: entry.digest.hash,
          fileCount: entry.digest.fileCount,
          archiveId: `${stamp}-${entry.source}`,
        }),
      ),
    ),
  });
  await atomicWrite(
    projectDir,
    path.join(staging, 'archive', MIGRATION_PROGRESS_FILE),
    `${JSON.stringify(progress, null, 2)}\n`,
  );
  await options.afterStagePrepared?.();
  const archives: OperateStorageArchive[] = [];
  let neutralParked = false;
  let stagingActivated = false;
  const moved = new Map<string, { originalPath: string; modes: TreeModes }>();
  try {
    if (inspection.legacyNeutralRoot) {
      await rename(inspection.legacyNeutralRoot, parkedNeutral);
      neutralParked = true;
      await options.afterParkNeutral?.();
    }
    await rename(staging, inspection.root);
    stagingActivated = true;
    await options.afterActivate?.();
    for (const entry of sources) {
      const currentPath = entry.source === 'operate-legacy' ? parkedNeutral : entry.path;
      const archivePath = path.join(inspection.root, 'archive', `${stamp}-${entry.source}`);
      await rename(currentPath, archivePath);
      moved.set(archivePath, { originalPath: currentPath, modes: entry.modes });
      await privatizeTree(archivePath);
      const archivedDigest = await digestTree(archivePath);
      if (
        archivedDigest.hash !== entry.digest.hash ||
        archivedDigest.fileCount !== entry.digest.fileCount
      ) {
        throw Object.assign(new Error(`Archived ${entry.source} bytes changed during migration.`), {
          code: 'OPERATE_STORE_CORRUPT',
        });
      }
      const archive = Object.freeze({
        archiveId: path.basename(archivePath),
        source: entry.source,
        ...archivedDigest,
      });
      archives.push(archive);
      await options.onArchive?.(archive);
    }
    const receipt = Object.freeze({
      kind: 'operate-storage-migration-receipt',
      migrated: true,
      archives: Object.freeze(archives),
      verificationProofHash,
    });
    await atomicWrite(
      projectDir,
      path.join(inspection.root, 'archive', `${stamp}-migration-receipt.json`),
      `${JSON.stringify(receipt, null, 2)}\n`,
    );
    await rm(path.join(inspection.root, 'archive', MIGRATION_PROGRESS_FILE), { force: true });
    return receipt;
  } catch (error) {
    if ((error as { code?: string }).code === 'OPERATE_MIGRATION_INTERRUPTED') throw error;
    for (const [archivePath, original] of [...moved.entries()].reverse()) {
      if (await exists(archivePath)) {
        await rename(archivePath, original.originalPath);
        await restoreTreeModes(original.originalPath, original.modes);
      }
    }
    if (stagingActivated && (await exists(inspection.root))) await rename(inspection.root, staging);
    if (neutralParked && (await exists(parkedNeutral)))
      await rename(parkedNeutral, inspection.root);
    if (await exists(staging)) await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
