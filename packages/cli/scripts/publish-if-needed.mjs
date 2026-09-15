import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyPublicationIntegrity } from './publication-integrity.mjs';

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const spec = `${packageJson.name}@${packageJson.version}`;

function npmView(field) {
  return spawnSync('npm', ['view', spec, field, '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function publishedIntegrity() {
  const version = npmView('version');
  if (version.status !== 0) return null;
  if (JSON.parse(version.stdout) !== packageJson.version) {
    throw new Error(`Registry returned an unexpected version for ${spec}.`);
  }
  const integrity = npmView('dist.integrity');
  if (integrity.status !== 0) {
    throw new Error(`Registry did not return integrity for existing ${spec}.`);
  }
  return JSON.parse(integrity.stdout);
}

function prepareCandidate() {
  const destination = mkdtempSync(join(tmpdir(), 'openplanr-publish-candidate-'));
  try {
    execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
    const report = JSON.parse(
      execFileSync(
        'npm',
        ['pack', '--json', '--ignore-scripts', '--pack-destination', destination],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
      ),
    );
    const filename = report[0]?.filename;
    if (typeof filename !== 'string' || report.length !== 1) {
      throw new Error('npm pack did not produce exactly one candidate archive.');
    }
    const archive = join(destination, filename);
    return Object.freeze({
      archive,
      destination,
      integrity: `sha512-${createHash('sha512')
        .update(readFileSync(archive))
        .digest('base64')}`,
    });
  } catch (error) {
    rmSync(destination, { recursive: true, force: true });
    throw error;
  }
}

const candidate = prepareCandidate();

function registryState() {
  return classifyPublicationIntegrity({
    publishedIntegrity: publishedIntegrity(),
    candidateIntegrity: candidate.integrity,
  });
}

async function reconcilePublication(publishStatus) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 2_000));
    const state = registryState();
    if (state === 'identical') return true;
    if (state === 'conflict') {
      throw new Error(`${spec} appeared with different bytes after the publish attempt.`);
    }
  }
  if (publishStatus === 0) {
    throw new Error(`${spec} publish succeeded but npm did not expose the reviewed bytes.`);
  }
  return false;
}

try {
  const initialState = registryState();
  if (initialState === 'identical') {
    console.log(`${spec} is already published with identical bytes; skipping.`);
    process.exitCode = 0;
  } else if (initialState === 'conflict') {
    throw new Error(`${spec} already exists with different bytes; choose a new version.`);
  } else {
    const publish = spawnSync(
      'npm',
      ['publish', candidate.archive, '--ignore-scripts', '--access', 'public', '--provenance'],
      { stdio: 'inherit' },
    );
    // npm can report a late registry error after accepting a package and its
    // provenance statement. A successful command can also precede registry
    // visibility. In both cases, release success requires the reviewed bytes.
    const reconciled = await reconcilePublication(publish.status);
    if (reconciled && publish.status !== 0) {
      console.log(`${spec} is present in npm with identical bytes after the publish error.`);
    }
    process.exitCode = reconciled ? 0 : (publish.status ?? 1);
  }
} finally {
  rmSync(candidate.destination, { recursive: true, force: true });
}
