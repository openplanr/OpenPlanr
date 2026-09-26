import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

function candidateFailure(message) {
  const error = new Error(message);
  error.code = 'E_PIPELINE_CANDIDATE_INVALID';
  throw error;
}

function defaultCandidateLocations(openPlanrRoot) {
  return [{ kind: 'workspace-package', path: resolve(openPlanrRoot, '..', 'pipeline') }];
}

/**
 * Resolve one repository-bound pipeline source candidate. There is deliberately
 * no environment or caller-provided tarball authority: local and CI release
 * gates both use the exact pipeline package in the consolidated workspace.
 */
export function resolvePipelineCandidateSourceRoot({ openPlanrRoot, candidateLocations } = {}) {
  const presentedRoot = resolve(openPlanrRoot ?? process.cwd());
  if (
    !existsSync(presentedRoot) ||
    !lstatSync(presentedRoot).isDirectory() ||
    lstatSync(presentedRoot).isSymbolicLink()
  ) {
    candidateFailure('The OpenPlanr release root is not a real directory.');
  }
  const root = realpathSync(presentedRoot);
  const locations = candidateLocations ?? defaultCandidateLocations(root);
  if (!Array.isArray(locations) || locations.length === 0) {
    candidateFailure('No bounded pipeline candidate locations are declared.');
  }
  const resolved = [];
  for (const location of locations) {
    if (!location || typeof location.kind !== 'string' || typeof location.path !== 'string') {
      candidateFailure('A bounded pipeline candidate location is malformed.');
    }
    const lexicalRoot = resolve(location.path);
    if (!existsSync(lexicalRoot)) continue;
    const stat = lstatSync(lexicalRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      candidateFailure(`The ${location.kind} pipeline candidate is not a real directory.`);
    }
    const sourceRoot = realpathSync(lexicalRoot);
    if (sourceRoot !== lexicalRoot) {
      candidateFailure(`The ${location.kind} pipeline candidate crosses a filesystem alias.`);
    }
    const manifestPath = join(sourceRoot, 'package.json');
    if (!existsSync(manifestPath) || lstatSync(manifestPath).isSymbolicLink()) {
      candidateFailure(`The ${location.kind} pipeline candidate has no real package manifest.`);
    }
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
      candidateFailure(`The ${location.kind} pipeline candidate manifest is invalid.`);
    }
    if (manifest?.name !== 'planr-pipeline' || typeof manifest.version !== 'string') {
      candidateFailure(`The ${location.kind} checkout is not a planr-pipeline candidate.`);
    }
    resolved.push({ kind: location.kind, root: sourceRoot, manifest });
  }
  if (resolved.length === 0) {
    candidateFailure(
      'No repository-bound planr-pipeline candidate exists in the consolidated workspace.',
    );
  }
  if (resolved.length !== 1) {
    candidateFailure(
      'More than one bounded planr-pipeline candidate exists; candidate custody is ambiguous.',
    );
  }
  return resolved[0];
}

export function isPathInside(parent, candidate) {
  const childPath = relative(realpathSync(parent), realpathSync(candidate));
  return (
    childPath.length > 0 &&
    childPath !== '..' &&
    !childPath.startsWith(`..${sep}`) &&
    !isAbsolute(childPath)
  );
}
