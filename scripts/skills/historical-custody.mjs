import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const evidencePath = fileURLToPath(new URL('./legacy-custody-baseline.json', import.meta.url));

function validObject(object) {
  return (
    typeof object?.path === 'string' &&
    object.path
      .split('/')
      .every((part) => /^[a-zA-Z0-9_.-]+$/u.test(part) && !['.', '..'].includes(part)) &&
    typeof object.sha256 === 'string' &&
    /^[a-f0-9]{64}$/u.test(object.sha256)
  );
}

function readGitObject(root, commit, object) {
  try {
    return execFileSync(
      'git',
      ['--no-pager', 'show', '--no-textconv', `${commit}:${object.path}`],
      {
        cwd: root,
        maxBuffer: 2 * 1024 * 1024,
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } catch {
    return null;
  }
}

function verifiedObject({ root, evidence, object, unavailable, readObject }) {
  if (!validObject(object)) throw new Error('Unsafe historical generated custody object.');
  const bytes = readObject(root, evidence.commit, object);
  if (bytes === null) {
    unavailable.push(object.path);
    return null;
  }
  if (digest(bytes) !== object.sha256)
    throw new Error(`Historical generated custody digest mismatch: ${object.path}`);
  return bytes;
}

function includeManifest(result, object, bytes) {
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest.kind === 'adapter-generated-assets' && Array.isArray(manifest.assets)) {
    result.suite.push(
      ...manifest.assets.map(({ path, digest }) => ({ target: path, sha256: digest })),
    );
  } else if (manifest.kind === 'canonical-skill-assets' && Array.isArray(manifest.skills)) {
    result.resources.push(
      ...manifest.skills.flatMap(({ id, resources }) =>
        resources.map(({ path, digest }) => ({ target: `skills/${id}/${path}`, sha256: digest })),
      ),
    );
  } else throw new Error(`Unsupported historical custody manifest: ${object.path}`);
}

/**
 * One migration baseline, bound to reviewed Git object bytes. A shallow checkout may lack
 * these objects: it then preserves unknown old files instead of inferring their ownership.
 * New retirements use the ignored per-checkout ledger; this is not an ongoing cleanup list.
 */
export function readHistoricalCustody({
  root,
  evidence = JSON.parse(readFileSync(evidencePath, 'utf8')),
  readObject = readGitObject,
}) {
  if (
    evidence?.schemaVersion !== '1.0.0' ||
    evidence?.kind !== 'openplanr-legacy-generated-custody' ||
    !/^[a-f0-9]{40}$/u.test(evidence.commit) ||
    !Array.isArray(evidence.manifests) ||
    !Array.isArray(evidence.copies)
  )
    throw new Error('Unsupported historical generated custody evidence.');
  const result = { suite: [], resources: [], copies: [], unavailable: [] };
  const verified = (object) =>
    verifiedObject({ root, evidence, object, unavailable: result.unavailable, readObject });
  for (const object of evidence.manifests) {
    const bytes = verified(object);
    if (bytes === null) continue;
    includeManifest(result, object, bytes);
  }
  for (const object of evidence.copies) {
    if (!Array.isArray(object.targets))
      throw new Error(`Missing historical copy targets: ${object.path}`);
    if (verified(object) === null) continue;
    result.copies.push(...object.targets.map((target) => ({ target, sha256: object.sha256 })));
  }
  return result;
}
