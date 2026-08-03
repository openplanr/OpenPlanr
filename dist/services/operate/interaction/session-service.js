import { execFile } from 'node:child_process';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { resolveGuidedInteractionValidators } from '../../pipeline-package-service.js';
import { canonicalDigest, canonicalize, sha256Digest } from '../canonical.js';
import { parseStrictJson } from '../evidence-import.js';
import { OperateError, } from '../types.js';
import { resolveOperatingPaths, resolveOperatingProject } from '../workspace.js';
export const GUIDED_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const GUIDED_ANSWER_MAX_BYTES = 64 * 1024;
const SESSION_ID = /^GIS-[A-Za-z0-9._-]{8,128}$/;
const execFileAsync = promisify(execFile);
const STATE_WRITE_ERROR_CODES = new Set([
    'EACCES',
    'EDQUOT',
    'ENOSPC',
    'ENOTDIR',
    'EPERM',
    'EROFS',
]);
function guidedStateWriteError(error) {
    const code = error?.code;
    if (!code || !STATE_WRITE_ERROR_CODES.has(code))
        return null;
    return new OperateError('E_OPERATE_STATE_UNAVAILABLE', 'Operating Board cannot write its machine-local guided-session state. Grant the active runtime sandbox write access to OPENPLANR_STATE_ROOT (or the default ~/.planr state root), then retry.', {
        stateClass: 'machine-local',
        requiredPermission: 'write',
        platformCode: code,
        recoveryCommand: 'planr operate init --json',
    });
}
export function createGuidedSessionId() {
    return `GIS-${randomBytes(18).toString('base64url')}`;
}
export async function currentGuidedSessionBindings(projectRoot) {
    const resolved = await resolveOperatingProject(projectRoot).catch(() => path.resolve(projectRoot));
    const paths = resolveOperatingPaths(resolved);
    const [config, events] = await Promise.all([
        readFile(paths.config).catch(() => null),
        readFile(paths.events).catch(() => null),
    ]);
    const [revision, status] = await Promise.all([
        execFileAsync('git', ['rev-parse', '--verify', 'HEAD'], {
            cwd: resolved,
            env: { PATH: process.env.PATH ?? '' },
            timeout: 10_000,
        }).then(({ stdout }) => stdout.trim(), () => null),
        execFileAsync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
            cwd: resolved,
            env: { PATH: process.env.PATH ?? '' },
            timeout: 10_000,
            maxBuffer: 5 * 1024 * 1024,
        }).then(({ stdout }) => stdout.trim(), () => null),
    ]);
    const projectIdentity = canonicalDigest({ projectRoot: resolved });
    const configHead = config ? sha256Digest(config) : canonicalDigest({ config: null });
    return {
        projectIdentity,
        configHead,
        projectHead: canonicalDigest({
            projectIdentity,
            configHead,
            eventHead: events ? sha256Digest(events) : null,
            revision,
            dirtyFingerprint: status ? sha256Digest(status) : null,
        }),
    };
}
function sessionPath(projectRoot, sessionId, localRoot) {
    if (!SESSION_ID.test(sessionId)) {
        throw new OperateError('E_OPERATE_SESSION_INVALID', 'Guided session ID is invalid.');
    }
    return path.join(resolveOperatingPaths(projectRoot, { localRoot }).sessions, `${sessionId}.json`);
}
function sessionMacPath(projectRoot, sessionId, localRoot) {
    return `${sessionPath(projectRoot, sessionId, localRoot)}.mac`;
}
function sessionKeyPath(projectRoot, localRoot) {
    return path.join(resolveOperatingPaths(projectRoot, { localRoot }).sessions, '.integrity-key');
}
async function loadOrCreateSessionKey(projectRoot, localRoot) {
    const target = sessionKeyPath(projectRoot, localRoot);
    const existing = await readFile(target).catch(() => null);
    if (existing)
        return existing;
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const key = randomBytes(32);
    await writeFile(target, key, { mode: 0o600, flag: 'wx' }).catch(async (error) => {
        if (error.code !== 'EEXIST')
            throw error;
    });
    return (await readFile(target).catch(() => key));
}
function sessionMac(raw, key) {
    return createHmac('sha256', key).update(raw).digest('base64url');
}
async function validateSession(session) {
    try {
        const errors = (await resolveGuidedInteractionValidators()).validateGuidedSession(session);
        if (errors.length > 0) {
            throw new OperateError('E_OPERATE_SESSION_INVALID', 'Guided session failed Protocol v1.2 validation.');
        }
    }
    catch (error) {
        if (error instanceof OperateError)
            throw error;
        throw new OperateError(error instanceof Error && error.name === 'E_PIPELINE_NOT_INSTALLED'
            ? 'E_PIPELINE_NOT_INSTALLED'
            : 'E_PIPELINE_VERSION_INCOMPATIBLE', error instanceof Error ? error.message : 'Guided session validators are unavailable.');
    }
}
async function atomicSessionWrite(projectRoot, session, localRoot) {
    await validateSession(session);
    try {
        const target = sessionPath(projectRoot, session.sessionId, localRoot);
        await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        const raw = `${canonicalize(session)}\n`;
        const key = await loadOrCreateSessionKey(projectRoot, localRoot);
        const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
        const macTarget = sessionMacPath(projectRoot, session.sessionId, localRoot);
        const macTemporary = `${macTarget}.${process.pid}.${randomUUID()}.tmp`;
        await writeFile(temporary, raw, { mode: 0o600, flag: 'wx' });
        await writeFile(macTemporary, `${sessionMac(raw, key)}\n`, { mode: 0o600, flag: 'wx' });
        await rename(temporary, target);
        await rename(macTemporary, macTarget);
        await chmod(target, 0o600);
        await chmod(macTarget, 0o600);
    }
    catch (error) {
        const normalized = guidedStateWriteError(error);
        if (normalized)
            throw normalized;
        throw error;
    }
}
export async function createGuidedSession(input) {
    const now = input.now ?? new Date();
    const session = {
        kind: 'guided-session',
        schemaVersion: '1.0.0',
        protocolVersion: '1.2.0',
        sessionId: input.questionnaire.sessionId,
        state: 'awaiting-input',
        command: input.questionnaire.command,
        projectIdentity: input.questionnaire.projectIdentity,
        projectHead: input.questionnaire.projectHead,
        configHead: input.questionnaire.configHead,
        questionnaireDigest: input.questionnaire.digest,
        questionnaireVersion: input.questionnaire.questionnaireVersion,
        adapter: input.questionnaire.adapter,
        persistedAnswers: (input.persistedAnswers ?? [])
            .filter((answer) => answer.sensitivity !== 'sensitive')
            .map((answer) => structuredClone(answer)),
        createdAt: input.questionnaire.createdAt,
        updatedAt: now.toISOString(),
        expiresAt: input.questionnaire.expiresAt,
    };
    await atomicSessionWrite(input.projectRoot, session, input.localRoot);
    return session;
}
function terminalSessionError(session) {
    // A stale head is the one recoverable terminal condition: the session record
    // still exists and its bindings are re-evaluated fresh on every read, so once
    // the working tree is restored to the state it was created in, resuming THIS
    // session succeeds. Point the operator at that resume, naming the real session,
    // instead of `init --json`, which would mint a fresh session bound to the same
    // still-diverged head and fail the same way. Genuinely dead conditions
    // (cancelled / expired past its TTL / tampered-invalid) are not resumable, so
    // starting a new session is the correct recovery for them.
    const resumeCommand = `planr operate init --resume ${session.sessionId} --json`;
    switch (session.state) {
        case 'cancelled':
            return new OperateError('E_OPERATE_SESSION_CANCELLED', 'Guided session was cancelled. Start a new initialization session.', { state: session.state, recoveryCommand: 'planr operate init --json' });
        case 'expired':
            return new OperateError('E_OPERATE_SESSION_EXPIRED', 'Guided session expired after 24 hours. Start a new initialization session.', { state: session.state, recoveryCommand: 'planr operate init --json' });
        case 'stale':
            return new OperateError('E_OPERATE_SESSION_STALE', `Guided session ${session.sessionId} no longer matches the project or configuration head. Restore the working tree to the state the session was created in, then resume it with \`${resumeCommand}\`.`, { state: session.state, sessionId: session.sessionId, recoveryCommand: resumeCommand });
        case 'invalid':
            return new OperateError('E_OPERATE_SESSION_INVALID', 'Guided session is invalid or was tampered with.', { state: session.state, recoveryCommand: 'planr operate init --json' });
        default:
            return null;
    }
}
export async function readGuidedSession(input) {
    const target = sessionPath(input.projectRoot, input.sessionId, input.localRoot);
    let raw;
    try {
        raw = await readFile(target, 'utf8');
    }
    catch {
        throw new OperateError('E_OPERATE_SESSION_INVALID', 'Guided session does not exist or was already purged.', { state: 'invalid', recoveryCommand: 'planr operate init --json' });
    }
    try {
        const info = await stat(target);
        // POSIX mode bits are not meaningful on Windows (Node reports the
        // synthesized 0o666 value even after chmod). Windows relies on the
        // machine-local user profile ACL and the integrity MAC instead.
        if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) {
            throw new OperateError('E_OPERATE_SESSION_INVALID', 'Guided session permissions are unsafe; the session was rejected.', { state: 'invalid', recoveryCommand: 'planr operate init --json' });
        }
        const key = await readFile(sessionKeyPath(input.projectRoot, input.localRoot));
        const expected = Buffer.from(sessionMac(raw, key));
        const actual = Buffer.from((await readFile(sessionMacPath(input.projectRoot, input.sessionId, input.localRoot), 'utf8')).trim());
        if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
            throw new OperateError('E_OPERATE_SESSION_INVALID', 'Guided session integrity verification failed.', { state: 'invalid', recoveryCommand: 'planr operate init --json' });
        }
        const parsed = parseStrictJson(raw, {
            maxBytes: GUIDED_ANSWER_MAX_BYTES,
            maxDepth: 16,
            maxScalars: 500,
            maxStringLength: 4096,
        });
        await validateSession(parsed);
        if (parsed.sessionId !== input.sessionId) {
            throw new OperateError('E_OPERATE_SESSION_INVALID', 'Guided session identity does not match its machine-local record.');
        }
        const terminal = terminalSessionError(parsed);
        if (terminal)
            throw terminal;
        const now = input.now ?? new Date();
        if (now.getTime() >= Date.parse(parsed.expiresAt)) {
            await updateGuidedSession({
                projectRoot: input.projectRoot,
                session: {
                    ...parsed,
                    state: 'expired',
                    updatedAt: now.toISOString(),
                    terminalReason: 'The 24-hour guided session lifetime elapsed.',
                },
                localRoot: input.localRoot,
            });
            throw terminalSessionError({ ...parsed, state: 'expired' });
        }
        const bindings = input.bindings ?? (await currentGuidedSessionBindings(input.projectRoot));
        if (parsed.projectIdentity !== bindings.projectIdentity ||
            parsed.projectHead !== bindings.projectHead ||
            parsed.configHead !== bindings.configHead) {
            // Staleness is re-evaluated fresh on every read and never latched to disk:
            // the working-tree dirty fingerprint folded into `projectHead` flips the
            // moment any unrelated file changes, so persisting `state: 'stale'` here
            // would strand the session even after the tree is restored. Leaving the
            // record untouched lets a later read (with the tree back to its original
            // state) succeed — the un-latch that closes the guided-init livelock.
            throw terminalSessionError({ ...parsed, state: 'stale' });
        }
        return parsed;
    }
    catch (error) {
        if (error instanceof OperateError)
            throw error;
        throw new OperateError('E_OPERATE_SESSION_INVALID', 'Guided session is invalid or was tampered with.', { state: 'invalid', recoveryCommand: 'planr operate init --json' });
    }
}
export async function updateGuidedSession(input) {
    await atomicSessionWrite(input.projectRoot, input.session, input.localRoot);
}
export async function cancelGuidedSession(input) {
    const target = sessionPath(input.projectRoot, input.sessionId, input.localRoot);
    await Promise.all([
        rm(target, { force: true }),
        rm(sessionMacPath(input.projectRoot, input.sessionId, input.localRoot), { force: true }),
        rm(path.join(path.dirname(target), `${input.sessionId}.replays`), { force: true }),
    ]);
    return { sessionId: input.sessionId, state: 'cancelled', removed: true };
}
export async function guidedSessionStatus(input) {
    const directory = resolveOperatingPaths(input.projectRoot, {
        localRoot: input.localRoot,
    }).sessions;
    const names = await readdir(directory).catch(() => []);
    const now = (input.now ?? new Date()).getTime();
    let active = 0;
    let expired = 0;
    for (const name of names.filter((entry) => entry.endsWith('.json'))) {
        const record = await readFile(path.join(directory, name), 'utf8')
            .then((raw) => JSON.parse(raw))
            .catch(() => null);
        if (record?.expiresAt && Date.parse(record.expiresAt) <= now)
            expired += 1;
        else
            active += 1;
    }
    return { active, expired, files: active + expired };
}
export async function purgeGuidedSessions(input) {
    const directory = resolveOperatingPaths(input.projectRoot, {
        localRoot: input.localRoot,
    }).sessions;
    const names = await readdir(directory).catch(() => []);
    await Promise.all(names
        .filter((entry) => entry.startsWith('GIS-'))
        .map((entry) => rm(path.join(directory, entry), { force: true })));
    return {
        removed: new Set(names
            .filter((entry) => entry.startsWith('GIS-'))
            .map((entry) => entry.replace(/\.json(?:\.mac)?$|\.replays$/, ''))).size,
    };
}
export function guidedSessionState(session, state, now, values = {}) {
    return { ...session, ...values, state, updatedAt: now.toISOString() };
}
//# sourceMappingURL=session-service.js.map