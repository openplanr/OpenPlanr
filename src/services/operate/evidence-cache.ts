import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalDigest, canonicalize } from './canonical.js';
import { assertSensitivityAllowed, maximumSensitivity } from './redaction.js';
import type { OperatingEvidence, OperatingSensitivity } from './types.js';

/** Implementation-private cache envelope; it deliberately claims no Protocol kind/version. */
interface PrivateCacheRecord {
  implementation: 'openplanr-operate-cache';
  cacheKey: string;
  createdAt: string;
  expiresAt: string;
  sensitivity: OperatingSensitivity;
  evidence: OperatingEvidence;
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
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, `${canonicalize(record)}\n`, { mode: 0o600 });
    await rename(temporary, target);
    return digest;
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
