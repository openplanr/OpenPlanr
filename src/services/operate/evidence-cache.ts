import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalDigest, canonicalize } from './canonical.js';
import { assertSensitivityAllowed, containsSecret, maximumSensitivity } from './redaction.js';
import { OperateError, type OperatingEvidence, type OperatingSensitivity } from './types.js';

/** Implementation-private cache envelope; it deliberately claims no Protocol kind/version. */
interface PrivateCacheRecord {
  implementation: 'openplanr-operate-cache';
  cacheKey: string;
  createdAt: string;
  expiresAt: string;
  sensitivity: OperatingSensitivity;
  evidence: OperatingEvidence;
}

/**
 * A single resolved-citation snapshot persisted as machine-local evidence. It
 * shares this cache's storage, TTL, and sensitivity-ceiling mechanics with the
 * collected-evidence records above but is a distinct envelope so the two never
 * collide: the collected-evidence file name is the record digest, while a
 * citation snapshot is addressed by its resolver-minted `evidenceId`.
 */
interface PrivateCitationSnapshotRecord {
  implementation: 'openplanr-operate-citation-snapshot';
  evidenceId: string;
  citationKey: string | null;
  snapshotDigest: `sha256:${string}`;
  sourceLocation: string;
  createdAt: string;
  expiresAt: string;
  sensitivity: OperatingSensitivity;
  content: string;
}

export interface CitationSnapshotInput {
  evidenceId: string;
  citationKey?: string | null;
  snapshotDigest: `sha256:${string}`;
  sourceLocation: string;
  sensitivity: OperatingSensitivity;
  /** Already redacted through the standard evidence redaction path before it is handed in. */
  content: string;
}

export class OperatingEvidenceCache {
  constructor(
    private readonly cacheRoot: string,
    private readonly sensitivityCeiling: OperatingSensitivity,
  ) {}

  async put(
    cacheKey: string,
    evidence: OperatingEvidence,
    ttlMs: number,
    now = new Date(),
  ): Promise<string> {
    for (const item of evidence.items) {
      assertSensitivityAllowed(item.sensitivity, this.sensitivityCeiling);
    }
    const record: PrivateCacheRecord = {
      implementation: 'openplanr-operate-cache',
      cacheKey,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      sensitivity: maximumSensitivity(evidence.items.map((item) => item.sensitivity)),
      evidence,
    };
    const digest = canonicalDigest(record).slice('sha256:'.length);
    await mkdir(this.cacheRoot, { recursive: true, mode: 0o700 });
    const target = path.join(this.cacheRoot, `${digest}.json`);
    // The temp name must be unique per WRITE, not per process. Since advisor
    // lenses record concurrently, two lenses citing the same file derive the
    // same evidence id and therefore the same target; a pid-only suffix gave
    // them one shared temp path, so the first rename consumed it and the second
    // failed ENOENT — surfacing as "<lens> failed before recording an analysis".
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${canonicalize(record)}\n`, { mode: 0o600 });
    await rename(temporary, target);
    return digest;
  }

  private citationSnapshotTarget(evidenceId: string): string {
    return path.join(
      this.cacheRoot,
      `citation-${canonicalDigest(evidenceId).slice('sha256:'.length)}.json`,
    );
  }

  /**
   * Persist a resolved-citation snapshot as machine-local evidence, addressed by
   * its resolver-minted `evidenceId`. Enforces the same sensitivity ceiling as
   * collected evidence and refuses to persist any content that still matches a
   * secret pattern — the snapshot is redacted upstream, and this is the
   * fail-closed guard that keeps a raw secret off disk. Returns the `evidenceId`.
   */
  async putCitationSnapshot(
    input: CitationSnapshotInput,
    ttlMs: number,
    now = new Date(),
  ): Promise<string> {
    assertSensitivityAllowed(input.sensitivity, this.sensitivityCeiling);
    if (containsSecret(input.content)) {
      throw new OperateError(
        'E_OPERATE_SECRET_DETECTED',
        'A citation snapshot must be redacted before it is persisted to machine-local evidence.',
      );
    }
    const record: PrivateCitationSnapshotRecord = {
      implementation: 'openplanr-operate-citation-snapshot',
      evidenceId: input.evidenceId,
      citationKey: input.citationKey ?? null,
      snapshotDigest: input.snapshotDigest,
      sourceLocation: input.sourceLocation,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      sensitivity: input.sensitivity,
      content: input.content,
    };
    await mkdir(this.cacheRoot, { recursive: true, mode: 0o700 });
    const target = this.citationSnapshotTarget(input.evidenceId);
    // The temp name must be unique per WRITE, not per process. Since advisor
    // lenses record concurrently, two lenses citing the same file derive the
    // same evidence id and therefore the same target; a pid-only suffix gave
    // them one shared temp path, so the first rename consumed it and the second
    // failed ENOENT — surfacing as "<lens> failed before recording an analysis".
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${canonicalize(record)}\n`, { mode: 0o600 });
    await rename(temporary, target);
    return input.evidenceId;
  }

  /** Read back a resolved-citation snapshot by its `evidenceId`, honouring TTL and the sensitivity ceiling. */
  async getCitationSnapshot(
    evidenceId: string,
    now = new Date(),
  ): Promise<
    { content: string; sensitivity: OperatingSensitivity; sourceLocation: string } | undefined
  > {
    const target = this.citationSnapshotTarget(evidenceId);
    let record: PrivateCitationSnapshotRecord;
    try {
      record = JSON.parse(await readFile(target, 'utf8')) as PrivateCitationSnapshotRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    if (
      record.implementation !== 'openplanr-operate-citation-snapshot' ||
      record.evidenceId !== evidenceId
    ) {
      return undefined;
    }
    if (Date.parse(record.expiresAt) <= now.getTime()) {
      await unlink(target).catch(() => undefined);
      return undefined;
    }
    assertSensitivityAllowed(record.sensitivity, this.sensitivityCeiling);
    return {
      content: record.content,
      sensitivity: record.sensitivity,
      sourceLocation: record.sourceLocation,
    };
  }

  async get(digest: string, now = new Date()): Promise<OperatingEvidence | undefined> {
    const target = path.join(this.cacheRoot, `${digest}.json`);
    let record: PrivateCacheRecord;
    try {
      record = JSON.parse(await readFile(target, 'utf8')) as PrivateCacheRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    if (
      record.implementation !== 'openplanr-operate-cache' ||
      canonicalDigest(record).slice('sha256:'.length) !== digest
    ) {
      return undefined;
    }
    if (Date.parse(record.expiresAt) <= now.getTime()) {
      await unlink(target).catch(() => undefined);
      return undefined;
    }
    assertSensitivityAllowed(record.sensitivity, this.sensitivityCeiling);
    return record.evidence;
  }

  async status(now = new Date()): Promise<{ entries: number; expired: number; bytes: number }> {
    let entries = 0;
    let expired = 0;
    let bytes = 0;
    for (const name of await readdir(this.cacheRoot).catch(() => [])) {
      if (!name.endsWith('.json')) continue;
      try {
        const raw = await readFile(path.join(this.cacheRoot, name), 'utf8');
        const record = JSON.parse(raw) as PrivateCacheRecord;
        entries += 1;
        bytes += Buffer.byteLength(raw);
        if (Date.parse(record.expiresAt) <= now.getTime()) expired += 1;
      } catch {
        expired += 1;
      }
    }
    return { entries, expired, bytes };
  }

  async purgeExpired(now = new Date(), options: { all?: boolean } = {}): Promise<string[]> {
    const removed: string[] = [];
    for (const name of await readdir(this.cacheRoot).catch(() => [])) {
      if (!name.endsWith('.json')) continue;
      const target = path.join(this.cacheRoot, name);
      try {
        const record = JSON.parse(await readFile(target, 'utf8')) as PrivateCacheRecord;
        if (options.all || Date.parse(record.expiresAt) <= now.getTime()) {
          await unlink(target);
          removed.push(name);
        }
      } catch {
        await unlink(target).catch(() => undefined);
        removed.push(name);
      }
    }
    return removed.sort();
  }
}
