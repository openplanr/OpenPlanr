import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalDigest, canonicalize } from './canonical.js';
import { assertSensitivityAllowed, containsSecret, maximumSensitivity } from './redaction.js';
import { OperateError } from './types.js';
export class OperatingEvidenceCache {
    cacheRoot;
    sensitivityCeiling;
    constructor(cacheRoot, sensitivityCeiling) {
        this.cacheRoot = cacheRoot;
        this.sensitivityCeiling = sensitivityCeiling;
    }
    async put(cacheKey, evidence, ttlMs, now = new Date()) {
        for (const item of evidence.items) {
            assertSensitivityAllowed(item.sensitivity, this.sensitivityCeiling);
        }
        const record = {
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
    citationSnapshotTarget(evidenceId) {
        return path.join(this.cacheRoot, `citation-${canonicalDigest(evidenceId).slice('sha256:'.length)}.json`);
    }
    /**
     * Persist a resolved-citation snapshot as machine-local evidence, addressed by
     * its resolver-minted `evidenceId`. Enforces the same sensitivity ceiling as
     * collected evidence and refuses to persist any content that still matches a
     * secret pattern — the snapshot is redacted upstream, and this is the
     * fail-closed guard that keeps a raw secret off disk. Returns the `evidenceId`.
     */
    async putCitationSnapshot(input, ttlMs, now = new Date()) {
        assertSensitivityAllowed(input.sensitivity, this.sensitivityCeiling);
        if (containsSecret(input.content)) {
            throw new OperateError('E_OPERATE_SECRET_DETECTED', 'A citation snapshot must be redacted before it is persisted to machine-local evidence.');
        }
        const record = {
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
        const temporary = `${target}.${process.pid}.tmp`;
        await writeFile(temporary, `${canonicalize(record)}\n`, { mode: 0o600 });
        await rename(temporary, target);
        return input.evidenceId;
    }
    /** Read back a resolved-citation snapshot by its `evidenceId`, honouring TTL and the sensitivity ceiling. */
    async getCitationSnapshot(evidenceId, now = new Date()) {
        const target = this.citationSnapshotTarget(evidenceId);
        let record;
        try {
            record = JSON.parse(await readFile(target, 'utf8'));
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return undefined;
            throw error;
        }
        if (record.implementation !== 'openplanr-operate-citation-snapshot' ||
            record.evidenceId !== evidenceId) {
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
    async get(digest, now = new Date()) {
        const target = path.join(this.cacheRoot, `${digest}.json`);
        let record;
        try {
            record = JSON.parse(await readFile(target, 'utf8'));
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return undefined;
            throw error;
        }
        if (record.implementation !== 'openplanr-operate-cache' ||
            canonicalDigest(record).slice('sha256:'.length) !== digest) {
            return undefined;
        }
        if (Date.parse(record.expiresAt) <= now.getTime()) {
            await unlink(target).catch(() => undefined);
            return undefined;
        }
        assertSensitivityAllowed(record.sensitivity, this.sensitivityCeiling);
        return record.evidence;
    }
    async status(now = new Date()) {
        let entries = 0;
        let expired = 0;
        let bytes = 0;
        for (const name of await readdir(this.cacheRoot).catch(() => [])) {
            if (!name.endsWith('.json'))
                continue;
            try {
                const raw = await readFile(path.join(this.cacheRoot, name), 'utf8');
                const record = JSON.parse(raw);
                entries += 1;
                bytes += Buffer.byteLength(raw);
                if (Date.parse(record.expiresAt) <= now.getTime())
                    expired += 1;
            }
            catch {
                expired += 1;
            }
        }
        return { entries, expired, bytes };
    }
    async purgeExpired(now = new Date(), options = {}) {
        const removed = [];
        for (const name of await readdir(this.cacheRoot).catch(() => [])) {
            if (!name.endsWith('.json'))
                continue;
            const target = path.join(this.cacheRoot, name);
            try {
                const record = JSON.parse(await readFile(target, 'utf8'));
                if (options.all || Date.parse(record.expiresAt) <= now.getTime()) {
                    await unlink(target);
                    removed.push(name);
                }
            }
            catch {
                await unlink(target).catch(() => undefined);
                removed.push(name);
            }
        }
        return removed.sort();
    }
}
//# sourceMappingURL=evidence-cache.js.map