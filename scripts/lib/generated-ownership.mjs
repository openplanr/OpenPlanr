import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const validDigest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const keyOf = ({ owner, target }) => `${owner}\0${target}`;

function validateRelativeTarget(target) {
  if (
    typeof target !== 'string' ||
    target.length === 0 ||
    target.includes('\\') ||
    target.includes('\0') ||
    isAbsolute(target) ||
    target.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error(`Unsafe generated output path: ${String(target)}`);
}

function inspectPathPart(path, target, last) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  if (stat.isSymbolicLink()) throw new Error(`Symlink in generated output path: ${target}`);
  if (!last && !stat.isDirectory())
    throw new Error(`Non-directory in generated output path: ${target}`);
  if (last && !stat.isFile()) throw new Error(`Generated output is not a regular file: ${target}`);
  return true;
}

/** Validate the complete path, including ancestors: lexical containment alone permits symlinks. */
export function generatedPath(root, target) {
  validateRelativeTarget(target);
  const absolute = resolve(root, target);
  const contained = relative(root, absolute);
  if (contained.startsWith(`..${sep}`) || contained === '..' || isAbsolute(contained))
    throw new Error(`Generated output escapes its root: ${target}`);
  const parts = target.split('/');
  let path = resolve(root);
  const rootStat = lstatSync(path);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory())
    throw new Error(`Generated output root must be a real directory: ${root}`);
  for (let index = 0; index < parts.length; index += 1) {
    path = resolve(path, parts[index]);
    if (!inspectPathPart(path, target, index === parts.length - 1)) break;
  }
  return absolute;
}

/** Write through an owned sibling file and recheck custody immediately before replacement. */
export function writeGeneratedOutput({ root, target, bytes, mode, recheck = () => {} }) {
  const destination = generatedPath(root, target);
  mkdirSync(dirname(destination), { recursive: true });
  generatedPath(root, target);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(temporary, 'wx', mode);
    try {
      writeFileSync(fd, bytes);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    generatedPath(root, target);
    recheck();
    renameSync(temporary, destination);
    chmodSync(destination, mode);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function readRegular(root, target) {
  const path = generatedPath(root, target);
  try {
    return readFileSync(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Local ownership survives pulls and branch switches because it is separate from tracked
 * manifests. A manifest bootstraps ownership only when its recorded bytes still match.
 * Each generator owns one scope, under the checkout's already ignored .cache directory.
 */
export class GeneratedOwnership {
  constructor({ root, scope, owns }) {
    if (!/^[a-z][a-z0-9-]*$/u.test(scope)) throw new Error(`Unsafe ownership scope: ${scope}`);
    this.root = resolve(root);
    this.scope = scope;
    this.owns = owns;
    this.target = `.cache/openplanr/generated-ownership/${scope}.json`;
    this.original = readRegular(this.root, this.target);
    this.records = new Map();
    this.unproven = new Map();
    if (this.original === null) return;
    let ledger;
    try {
      ledger = JSON.parse(this.original.toString('utf8'));
    } catch {
      throw new Error(`Malformed generated ownership ledger: ${this.target}`);
    }
    if (
      ledger?.schemaVersion !== '1.0.0' ||
      ledger?.kind !== 'openplanr-generated-ownership' ||
      ledger?.scope !== scope ||
      !Array.isArray(ledger.entries)
    )
      throw new Error(`Unsupported generated ownership ledger: ${this.target}`);
    for (const entry of ledger.entries) {
      this.validate(entry);
      if (this.records.has(keyOf(entry)))
        throw new Error(`Duplicate generated ownership entry: ${entry.target}`);
      this.records.set(keyOf(entry), entry);
    }
  }

  validate(entry) {
    if (
      typeof entry?.owner !== 'string' ||
      typeof entry?.target !== 'string' ||
      !validDigest(entry?.sha256) ||
      !this.owns(entry.owner, entry.target)
    )
      throw new Error(`Unowned generated output: ${String(entry?.target)}`);
    // Validate spelling independently of existence; stale symlinks must be reported without
    // trusting their contents during retirement, rather than invalidating the whole ledger.
    validateRelativeTarget(entry.target);
  }

  bootstrap(entries) {
    for (const candidate of entries) {
      this.validate(candidate);
      const key = keyOf(candidate);
      if (this.records.has(key)) continue;
      let actual;
      try {
        actual = readRegular(this.root, candidate.target);
      } catch (error) {
        this.unproven.set(key, { ...candidate, reason: error.message });
        continue;
      }
      if (actual === null) continue;
      if (digest(actual) === candidate.sha256) {
        this.records.set(key, {
          owner: candidate.owner,
          target: candidate.target,
          sha256: candidate.sha256,
        });
        this.unproven.delete(key);
      } else if (!this.unproven.has(key)) {
        this.unproven.set(key, { ...candidate, reason: 'unproven or modified bytes' });
      }
    }
    return this;
  }

  /** Existing outputs may be replaced only when owned bytes or the new canonical bytes match. */
  verifyWrites(entries) {
    const conflicts = [];
    for (const entry of entries) {
      this.validate(entry);
      try {
        const actual = readRegular(this.root, entry.target);
        if (actual === null) continue;
        const actualDigest = digest(actual);
        if (
          actualDigest === entry.sha256 ||
          this.records.get(keyOf(entry))?.sha256 === actualDigest
        )
          continue;
        conflicts.push({
          owner: entry.owner,
          target: entry.target,
          reason: 'unproven or modified bytes',
        });
      } catch (error) {
        conflicts.push({ owner: entry.owner, target: entry.target, reason: error.message });
      }
    }
    return conflicts;
  }

  inspectRetirement(entry) {
    let bytes;
    try {
      bytes = readRegular(this.root, entry.target);
    } catch (error) {
      return { reason: error.message };
    }
    if (bytes === null) return { missing: true };
    if (!this.records.has(keyOf(entry)) || digest(bytes) !== entry.sha256)
      return { reason: 'unproven or modified bytes' };
    return { unchanged: true };
  }

  removeUnchanged(entry, beforeRemove) {
    beforeRemove(entry);
    const current = this.inspectRetirement(entry);
    if (current.reason === 'unproven or modified bytes')
      return { reason: 'changed during retirement' };
    if (current.reason || current.missing) return current;
    unlinkSync(generatedPath(this.root, entry.target));
    return { removed: true };
  }

  /** Retire only recorded bytes. Recheck after planning, immediately before unlinking. */
  retire({ owners, expectedPaths, write = false, beforeRemove = () => {} }) {
    const selected = new Set(owners);
    const retired = [];
    const conflicts = [];
    const candidates = new Map([...this.unproven, ...this.records]);
    for (const [key, entry] of [...candidates].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      if (!selected.has(entry.owner) || expectedPaths.has(entry.target)) continue;
      const inspection = this.inspectRetirement(entry);
      const state =
        inspection.unchanged && write ? this.removeUnchanged(entry, beforeRemove) : inspection;
      if (state.reason) {
        conflicts.push({ owner: entry.owner, target: entry.target, reason: state.reason });
        continue;
      }
      if (state.missing || state.removed) this.records.delete(key);
      if (!state.missing)
        retired.push({ owner: entry.owner, target: entry.target, sha256: entry.sha256 });
    }
    return { retired, conflicts };
  }

  record(entries) {
    for (const entry of entries) {
      this.validate(entry);
      const actual = readRegular(this.root, entry.target);
      if (actual === null || digest(actual) !== entry.sha256)
        throw new Error(`Cannot record missing or changed generated output: ${entry.target}`);
      this.records.set(keyOf(entry), {
        owner: entry.owner,
        target: entry.target,
        sha256: entry.sha256,
      });
    }
    return this;
  }

  currentLedger() {
    const current = readRegular(this.root, this.target);
    if (
      (current === null) !== (this.original === null) ||
      (current !== null && !current.equals(this.original))
    )
      throw new Error(`Generated ownership changed concurrently; retry generation: ${this.target}`);
    return current;
  }

  save() {
    const current = this.currentLedger();
    const bytes = Buffer.from(
      `${JSON.stringify(
        {
          schemaVersion: '1.0.0',
          kind: 'openplanr-generated-ownership',
          scope: this.scope,
          entries: [...this.records.values()].sort((a, b) => keyOf(a).localeCompare(keyOf(b))),
        },
        null,
        2,
      )}\n`,
    );
    if (current?.equals(bytes)) return false;
    writeGeneratedOutput({
      root: this.root,
      target: this.target,
      bytes,
      mode: 0o600,
      recheck: () => this.currentLedger(),
    });
    this.original = bytes;
    return true;
  }
}
