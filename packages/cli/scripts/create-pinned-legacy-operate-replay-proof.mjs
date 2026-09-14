#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  unlink,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const PINNED_OPENPLANR_VERIFIER_COMMIT = '7859e52dd89f8b9a7e6934c57c9d5d4b0aee9106';
const PINNED_PIPELINE_VERIFIER_COMMIT = 'd6bcb5574aafbf0b50da19050ef865b85e52a30f';
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function pinnedRepositoryRoot({ explicit, candidates, commit, label, environmentName }) {
  const selected = explicit ? [path.resolve(explicit)] : candidates;
  for (const candidate of selected) {
    let canonical;
    try {
      canonical = await realpath(candidate);
    } catch {
      continue;
    }
    try {
      const resolved = run('git', ['rev-parse', '--verify', `${commit}^{commit}`], {
        cwd: canonical,
        capture: true,
      });
      if (resolved.trim() === commit) return canonical;
    } catch {
      // Try the next explicitly bounded candidate.
    }
  }
  throw new Error(
    `The exact ${label} verifier source is unavailable. Set ${environmentName} to a real Git checkout containing ${commit}.`,
  );
}

function usage() {
  return [
    'Usage:',
    '  node scripts/create-pinned-legacy-operate-replay-proof.mjs --project-dir <path> --output <path>',
    '',
    `Verifier candidate: OpenPlanr ${PINNED_OPENPLANR_VERIFIER_COMMIT}`,
    `Pipeline candidate: ${PINNED_PIPELINE_VERIFIER_COMMIT}`,
    'The command checks out those exact candidates in temporary worktrees, packs the exact',
    'pipeline bytes, performs the old candidate’s full read-only Event replay, and writes',
    'one host-path-free closed proof. It does not migrate or modify the legacy Store.',
  ].join('\n');
}

function argumentsOf(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const allowed = new Set(['--project-dir', '--output']);
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(option) || typeof value !== 'string' || value.length === 0) {
      throw new Error(`Unknown or incomplete option ${option ?? '<missing>'}.\n${usage()}`);
    }
    if (Object.hasOwn(values, option)) throw new Error(`Duplicate option ${option}.`);
    values[option] = value;
  }
  if (!values['--project-dir'] || !values['--output']) throw new Error(usage());
  return {
    help: false,
    projectDir: path.resolve(values['--project-dir']),
    output: path.resolve(values['--output']),
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: { ...process.env, ...options.env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stderr || result.stdout}` : '';
    throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}.${detail}`);
  }
  return options.capture ? result.stdout : '';
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function digestTree(root) {
  const records = [];
  const walk = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) {
        throw new Error(`Legacy Operate custody contains an unsupported entry: ${relative}`);
      }
      if (metadata.isDirectory()) {
        await walk(absolute);
      } else {
        const bytes = await readFile(absolute);
        records.push({
          path: relative,
          hash: createHash('sha256').update(bytes).digest('hex'),
          size: bytes.byteLength,
        });
      }
    }
  };
  await walk(root);
  return Object.freeze({ hash: sha256(JSON.stringify(records)), fileCount: records.length });
}

function closedReplay(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The pre-change candidate returned no replay report.');
  }
  const keys = Object.keys(value).sort();
  if (
    JSON.stringify(keys) !==
      JSON.stringify(['artifactHashes', 'currentGeneration', 'eventHead', 'pipelineVersion', 'productVersion', 'stateCanonicalHash']) ||
    typeof value.currentGeneration !== 'string' ||
    !HASH_PATTERN.test(value.stateCanonicalHash) ||
    !Array.isArray(value.artifactHashes) ||
    typeof value.productVersion !== 'string' ||
    typeof value.pipelineVersion !== 'string' ||
    value.eventHead === null ||
    typeof value.eventHead !== 'object' ||
    Array.isArray(value.eventHead) ||
    !Number.isSafeInteger(value.eventHead.sequence) ||
    (value.eventHead.sequence === 0
      ? value.eventHead.hash !== null
      : !HASH_PATTERN.test(value.eventHead.hash))
  ) {
    throw new Error('The pre-change candidate replay report is malformed.');
  }
  let priorArtifactId = '';
  const artifactHashes = value.artifactHashes.map((artifact) => {
    if (
      artifact === null ||
      typeof artifact !== 'object' ||
      Array.isArray(artifact) ||
      JSON.stringify(Object.keys(artifact).sort()) !== JSON.stringify(['artifactId', 'rawHash']) ||
      typeof artifact.artifactId !== 'string' ||
      artifact.artifactId <= priorArtifactId ||
      !HASH_PATTERN.test(artifact.rawHash)
    ) {
      throw new Error('The pre-change candidate returned invalid Artifact custody.');
    }
    priorArtifactId = artifact.artifactId;
    return Object.freeze({ artifactId: artifact.artifactId, rawHash: artifact.rawHash });
  });
  return Object.freeze({
    currentGeneration: value.currentGeneration,
    stateCanonicalHash: value.stateCanonicalHash,
    eventHead: Object.freeze({ sequence: value.eventHead.sequence, hash: value.eventHead.hash }),
    artifactHashes: Object.freeze(artifactHashes),
    productVersion: value.productVersion,
    pipelineVersion: value.pipelineVersion,
  });
}

function proofPayload(proof) {
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
      eventHead: {
        sequence: proof.replay.eventHead.sequence,
        hash: proof.replay.eventHead.hash,
      },
      artifactHashes: proof.replay.artifactHashes.map(({ artifactId, rawHash }) => ({
        artifactId,
        rawHash,
      })),
    },
    verifier: proof.verifier,
    verifiedAt: proof.verifiedAt,
  });
}

async function writeExclusive(target, content) {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporary, target);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

const runner = String.raw`
  import { createHash } from 'node:crypto';
  import { readFile } from 'node:fs/promises';
  import { createOperateV2Client } from './dist/services/operate-v2/client.js';
  import { sha256Jcs } from 'planr-pipeline/protocol';
  const projectDir = process.argv[1];
  const client = createOperateV2Client(projectDir);
  const runtime = await client.load();
  if (!runtime || typeof runtime.generation !== 'string') {
    throw new Error('The exact pre-change candidate found no replayable Operate Store.');
  }
  const product = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
  const pipeline = JSON.parse(await readFile(new URL('./node_modules/planr-pipeline/package.json', import.meta.url), 'utf8'));
  const artifactHashes = [...runtime.artifacts.entries()]
    .map(([artifactId, bytes]) => ({
      artifactId,
      rawHash: 'sha256:' + createHash('sha256').update(bytes).digest('hex'),
    }))
    .sort((left, right) => left.artifactId.localeCompare(right.artifactId));
  process.stdout.write(JSON.stringify({
    currentGeneration: runtime.generation,
    stateCanonicalHash: sha256Jcs(runtime.state),
    eventHead: runtime.state.eventHead,
    artifactHashes,
    productVersion: product.version,
    pipelineVersion: pipeline.version,
  }));
`;

async function main() {
  const options = argumentsOf(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const projectDir = await realpath(options.projectDir);
  const legacyRoot = path.join(projectDir, '.planr', 'operate-v2');
  const metadata = await lstat(legacyRoot).catch(() => null);
  if (!metadata?.isDirectory()) throw new Error('The project has no .planr/operate-v2 Store.');
  const openPlanrRepository = await pinnedRepositoryRoot({
    explicit: process.env.OPENPLANR_VERIFIER_SOURCE_ROOT,
    candidates: [scriptRoot],
    commit: PINNED_OPENPLANR_VERIFIER_COMMIT,
    label: 'OpenPlanr',
    environmentName: 'OPENPLANR_VERIFIER_SOURCE_ROOT',
  });
  const resolvedCommit = run(
    'git',
    ['rev-parse', '--verify', `${PINNED_OPENPLANR_VERIFIER_COMMIT}^{commit}`],
    { cwd: openPlanrRepository, capture: true },
  ).trim();
  if (resolvedCommit !== PINNED_OPENPLANR_VERIFIER_COMMIT) {
    throw new Error('The exact pinned OpenPlanr verifier commit is unavailable.');
  }
  const pipelineRepository = await pinnedRepositoryRoot({
    explicit: process.env.PLANR_PIPELINE_VERIFIER_SOURCE_ROOT,
    candidates: [projectDir],
    commit: PINNED_PIPELINE_VERIFIER_COMMIT,
    label: 'planr-pipeline',
    environmentName: 'PLANR_PIPELINE_VERIFIER_SOURCE_ROOT',
  });
  const resolvedPipelineCommit = run(
    'git',
    ['rev-parse', '--verify', `${PINNED_PIPELINE_VERIFIER_COMMIT}^{commit}`],
    { cwd: pipelineRepository, capture: true },
  ).trim();
  if (resolvedPipelineCommit !== PINNED_PIPELINE_VERIFIER_COMMIT) {
    throw new Error('The exact pinned planr-pipeline verifier commit is unavailable.');
  }

  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), 'openplanr-pinned-legacy-replay-proof-'),
  );
  const candidateRoot = path.join(temporaryRoot, 'candidate');
  const pipelineCandidateRoot = path.join(temporaryRoot, 'pipeline-candidate');
  let worktreeAdded = false;
  let pipelineWorktreeAdded = false;
  try {
    run('git', ['worktree', 'add', '--detach', candidateRoot, resolvedCommit], {
      cwd: openPlanrRepository,
    });
    worktreeAdded = true;
    run(
      'git',
      ['worktree', 'add', '--detach', pipelineCandidateRoot, resolvedPipelineCommit],
      { cwd: pipelineRepository },
    );
    pipelineWorktreeAdded = true;
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const packed = JSON.parse(
      run(
        npm,
        ['pack', '--ignore-scripts', '--json', '--pack-destination', temporaryRoot],
        { cwd: pipelineCandidateRoot, capture: true },
      ),
    );
    if (!Array.isArray(packed) || packed.length !== 1 || typeof packed[0]?.filename !== 'string') {
      throw new Error('The exact pinned pipeline candidate did not produce one package.');
    }
    const pipelineTarball = path.join(temporaryRoot, packed[0].filename);
    run(npm, ['ci', '--ignore-scripts', '--omit=optional'], { cwd: candidateRoot });
    run(npm, ['install', '--ignore-scripts', '--no-save', pipelineTarball], {
      cwd: candidateRoot,
    });
    run(npm, ['run', 'build:core'], { cwd: candidateRoot });
    const replay = closedReplay(
      JSON.parse(
        run(process.execPath, ['--input-type=module', '--eval', runner, projectDir], {
          cwd: candidateRoot,
          capture: true,
        }),
      ),
    );
    const unsigned = Object.freeze({
      kind: 'operate-legacy-replay-proof',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      source: 'operate-v2',
      projectFingerprint: sha256(`openplanr-operate-project\0${path.resolve(projectDir)}`),
      tree: await digestTree(legacyRoot),
      replay: Object.freeze({
        currentGeneration: replay.currentGeneration,
        stateCanonicalHash: replay.stateCanonicalHash,
        eventHead: replay.eventHead,
        artifactHashes: replay.artifactHashes,
      }),
      verifier: Object.freeze({
        product: 'openplanr',
        productVersion: `${replay.productVersion}+git.${resolvedCommit.slice(0, 12)}`,
        pipelinePackage: 'planr-pipeline',
        pipelineVersion: `${replay.pipelineVersion}+git.${resolvedPipelineCommit.slice(0, 12)}`,
      }),
      verifiedAt: new Date().toISOString(),
    });
    const proof = Object.freeze({ ...unsigned, receiptHash: sha256(proofPayload(unsigned)) });
    await writeExclusive(options.output, `${JSON.stringify(proof, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({
      kind: 'operate-legacy-replay-proof-written',
      verifierCommit: resolvedCommit,
      pipelineCommit: resolvedPipelineCommit,
      receiptHash: proof.receiptHash,
      fileCount: proof.tree.fileCount,
    })}\n`);
  } finally {
    if (worktreeAdded) {
      run('git', ['worktree', 'remove', '--force', candidateRoot], {
        cwd: openPlanrRepository,
      });
    }
    if (pipelineWorktreeAdded) {
      run('git', ['worktree', 'remove', '--force', pipelineCandidateRoot], {
        cwd: pipelineRepository,
      });
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
