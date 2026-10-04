import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import {
  GeneratedOwnership,
  generatedPath,
  writeGeneratedOutput,
} from '../lib/generated-ownership.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const within = (target, roots) =>
  typeof target === 'string' && roots.some((root) => target.startsWith(`${root}/`));

function readCurrent(root, target) {
  const absolute = generatedPath(root, target);
  try {
    return { bytes: readFileSync(absolute), mode: lstatSync(absolute).mode & 0o777 };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/** No recursive deletion: each ordinary file must have byte ownership before retirement. */
function actualOutputs(root, ownedRoots) {
  const paths = [];
  const visit = (absolute) => {
    const target = relative(root, absolute).split(sep).join('/');
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Symlink in generated skill outputs: ${target}`);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(absolute).sort()) visit(resolve(absolute, entry));
    } else if (stat.isFile()) paths.push(target);
    else throw new Error(`Unsupported generated skill output: ${target}`);
  };
  for (const ownedRoot of ownedRoots) {
    generatedPath(root, `${ownedRoot}/__ownership_probe__`);
    try {
      visit(resolve(root, ownedRoot));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return [...new Set(paths)].sort();
}

function matches(current, bytes, mode) {
  return current?.bytes.equals(bytes) && current.mode === mode;
}

function writeOwnedOutput({ root, entry, bytes, fileMode, custody }) {
  const recheck = () => {
    const concurrent = custody.verifyWrites([entry]);
    if (concurrent.length > 0)
      throw new Error(
        `Generated output changed during synchronization: ${JSON.stringify(concurrent)}`,
      );
  };
  recheck();
  writeGeneratedOutput({ root, target: entry.target, bytes, mode: fileMode, recheck });
}

function verifyNoConflicts({
  root,
  scope,
  expected,
  expectedPaths,
  custody,
  retirement,
  ownedRoots,
  preservePaths,
  completeRoots,
}) {
  const actual = (completeRoots ? actualOutputs(root, ownedRoots) : []).filter(
    (target) => !preservePaths.has(target),
  );
  const conflicts = [...custody.verifyWrites(expected), ...retirement.conflicts];
  const conflictsByTarget = new Set(conflicts.map(({ target }) => target));
  for (const target of actual) {
    if (expectedPaths.has(target) || conflictsByTarget.has(target)) continue;
    if (!custody.records.has(`${scope}\0${target}`))
      conflicts.push({ owner: scope, target, reason: 'unknown generated output preserved' });
  }
  if (conflicts.length > 0)
    throw new Error(
      `Generated output custody conflicts; preserve or reconcile these files:\n${JSON.stringify(conflicts, null, 2)}`,
    );
}

function finishSynchronization({
  mode,
  drift,
  retirement,
  custody,
  scope,
  expectedPaths,
  expected,
}) {
  if (mode === 'check') {
    drift.push(...retirement.retired.map(({ target }) => ({ target, reason: 'retired output' })));
    if (drift.length > 0)
      throw new Error(`Generated output drift:\n${JSON.stringify(drift, null, 2)}`);
  } else {
    const result = custody.retire({ owners: [scope], expectedPaths, write: true });
    if (result.conflicts.length > 0)
      throw new Error(
        `Generated outputs changed during retirement: ${JSON.stringify(result.conflicts)}`,
      );
    custody.record(expected).save();
    return result.retired.length;
  }
  return 0;
}

/**
 * Synchronize a complete generated closure. Caller supplies expected canonical bytes and prior
 * manifest digests; an existing file's observed bytes alone never establish retirement custody.
 * Check mode does not write outputs or the ignored ownership ledger. Partial roots preserve
 * unrelated hand-written files; only their recorded generated targets can be retired.
 */
export function syncGeneratedOutputs({
  root,
  scope,
  outputs,
  executable = new Set(),
  ownedRoots,
  bootstrap = [],
  mode,
  preservePaths = new Set(),
  beforeWrite = () => {},
  completeRoots = true,
}) {
  if (!['write', 'check'].includes(mode)) throw new Error(`Unsupported generated mode: ${mode}`);
  outputs = new Map([...outputs].map(([target, bytes]) => [target, Buffer.from(bytes)]));
  const owns = (owner, target) =>
    owner === scope && within(target, ownedRoots) && !preservePaths.has(target);
  const expected = [...outputs].map(([target, bytes]) => ({
    owner: scope,
    target,
    sha256: digest(bytes),
  }));
  for (const entry of expected) {
    if (!owns(entry.owner, entry.target))
      throw new Error(`Output leaves the generated scope: ${entry.target}`);
  }
  const custody = new GeneratedOwnership({ root, scope, owns }).bootstrap(
    bootstrap
      .filter(({ target }) => owns(scope, target))
      .map(({ target, sha256 }) => ({
        owner: scope,
        target,
        sha256: typeof sha256 === 'string' ? sha256.replace(/^sha256:/u, '') : sha256,
      })),
  );
  const expectedPaths = new Set(outputs.keys());
  const retirement = custody.retire({ owners: [scope], expectedPaths });
  verifyNoConflicts({
    root,
    scope,
    expected,
    expectedPaths,
    custody,
    retirement,
    ownedRoots,
    preservePaths,
    completeRoots,
  });
  const drift = [];
  let changedFiles = 0;
  for (const entry of expected.sort((a, b) => a.target.localeCompare(b.target))) {
    const bytes = outputs.get(entry.target);
    const fileMode = executable.has(entry.target) ? 0o755 : 0o644;
    if (matches(readCurrent(root, entry.target), bytes, fileMode)) continue;
    drift.push({ target: entry.target, reason: 'missing, changed bytes, or mode' });
    if (mode === 'write') {
      beforeWrite(entry);
      writeOwnedOutput({ root, entry, bytes, fileMode, custody });
      changedFiles += 1;
    }
  }
  changedFiles += finishSynchronization({
    mode,
    drift,
    retirement,
    custody,
    scope,
    expectedPaths,
    expected,
  });
  return { files: expected.length, changedFiles, retiredFiles: retirement.retired.length };
}
