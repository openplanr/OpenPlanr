import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spliceManagedBlock } from '../../utils/splice-managed-block.js';
import { canonicalDigest, canonicalize, sha256Digest } from './canonical.js';
import { OperatingEventStore, operatingRecordsLogLine } from './event-store.js';
import { detectGitignoredWorkspace } from './integrity.js';
import { applyJournalTransaction, prepareJournalTransaction, rollbackJournalTransaction, } from './journal.js';
import { withOperatingLock } from './lock-service.js';
import { prepareOperatingProjectionPersistence, renderOperatingProjectionFiles, } from './projection-persistence.js';
import { assertOperatingArtifact, loadOperatingProtocol } from './protocol.js';
import { OPERATE_PROTOCOL_VERSION, OPERATE_SCHEMA_VERSION, OperateError, } from './types.js';
import { buildWorkspaceManifest, ensureOperatingDirectories, projectMachineKey, resolveOperatingPaths, } from './workspace.js';
const ALL_ROLES = [
    'strategy-finance',
    'technology-risk',
    'product-activation',
    'growth-market',
    'operations-customer',
    'chair',
];
/** Protocol v1.2 requires these persisted fields; mandate execution no longer tunes them. */
export const FROZEN_OPERATING_PROVIDERS = ['repository', 'planr', 'git'];
export const FROZEN_OPERATING_BUDGETS = Object.freeze({
    maxFiles: 1_000,
    maxItems: 2_000,
    maxBytes: 10 * 1024 * 1024,
    maxDurationMs: 60_000,
});
function profile(id, title, description, overrides = {}) {
    return {
        id,
        title,
        description,
        enabledRoles: [...ALL_ROLES],
        caps: {
            surfacedFindings: 12,
            newSpecs: 3,
            openDecisions: 5,
            agentArtifacts: 4,
        },
        ...overrides,
    };
}
export const OPERATING_PROFILES = [
    profile('saas', 'SaaS', 'Balanced product, growth, risk, and operating review.'),
    profile('product', 'Product', 'Activation and customer-outcome focused review.'),
    profile('engineering', 'Engineering', 'Delivery, reliability, and risk focused review.', {
        enabledRoles: ['technology-risk', 'product-activation', 'operations-customer', 'chair'],
        caps: {
            surfacedFindings: 10,
            newSpecs: 3,
            openDecisions: 3,
            agentArtifacts: 2,
        },
    }),
    profile('custom', 'Custom', 'Explicit user-supplied operating configuration.'),
];
export function listOperatingProfiles() {
    return OPERATING_PROFILES.map((candidate) => structuredClone(candidate));
}
export function getOperatingProfile(id) {
    const candidate = listOperatingProfiles().find((entry) => entry.id === id);
    if (!candidate) {
        throw new OperateError('E_OPERATE_CONFIG_INVALID', `Unknown operating profile: ${id}.`);
    }
    return candidate;
}
const CUSTOM_PROFILE_FIELDS = new Set(['id', 'title', 'description', 'enabledRoles', 'caps']);
const CUSTOM_CAP_FIELDS = new Set([
    'surfacedFindings',
    'newSpecs',
    'openDecisions',
    'agentArtifacts',
]);
function plainRecord(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new OperateError('E_OPERATE_CONFIG_INVALID', `${label} must be a JSON object.`);
    }
    return value;
}
function boundedStringArray(value, label) {
    if (!Array.isArray(value) ||
        value.length > 64 ||
        value.some((entry) => typeof entry !== 'string' || entry.length > 256)) {
        throw new OperateError('E_OPERATE_CONFIG_INVALID', `${label} must be a bounded array of strings.`);
    }
    return [...new Set(value.map((entry) => entry.trim()).filter(Boolean))];
}
function numericOverrides(value, label, allowed) {
    const record = plainRecord(value, label);
    const unknown = Object.keys(record).filter((key) => !allowed.has(key));
    if (unknown.length > 0 || Object.values(record).some((entry) => !Number.isInteger(entry))) {
        throw new OperateError('E_OPERATE_CONFIG_INVALID', `${label} contains unsupported fields or non-integer values.`);
    }
    return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, Number(entry)]));
}
/**
 * Strictly allowlists custom-profile data before it can be echoed, persisted,
 * or merged. This is shared by init and profiles validate so unknown fields
 * (including accidental secrets) never reach command results.
 */
export function normalizeCustomOperatingProfile(value) {
    const record = plainRecord(value, 'Custom profile');
    const unknown = Object.keys(record).filter((key) => !CUSTOM_PROFILE_FIELDS.has(key));
    if (unknown.length > 0 || (record.id !== undefined && record.id !== 'custom')) {
        throw new OperateError('E_OPERATE_CONFIG_INVALID', 'Custom profile contains unsupported fields or identity.');
    }
    const normalized = {};
    if (record.id !== undefined)
        normalized.id = 'custom';
    for (const key of ['title', 'description']) {
        const entry = record[key];
        if (entry === undefined)
            continue;
        if (typeof entry !== 'string' || entry.trim().length === 0 || entry.length > 1_024) {
            throw new OperateError('E_OPERATE_CONFIG_INVALID', `Custom profile ${key} must be a non-empty bounded string.`);
        }
        normalized[key] = entry.trim();
    }
    if (record.enabledRoles !== undefined) {
        const roles = boundedStringArray(record.enabledRoles, 'Custom profile enabledRoles');
        if (roles.length === 0 || roles.some((role) => !ALL_ROLES.includes(role))) {
            throw new OperateError('E_OPERATE_CONFIG_INVALID', 'Custom profile enabledRoles contains an unknown role or is empty.');
        }
        normalized.enabledRoles = roles;
    }
    if (record.caps !== undefined) {
        const caps = numericOverrides(record.caps, 'Custom profile caps', CUSTOM_CAP_FIELDS);
        const maxima = {
            surfacedFindings: 50,
            newSpecs: 12,
            openDecisions: 20,
            agentArtifacts: 20,
        };
        if (Object.entries(caps).some(([key, entry]) => entry < 1 || entry > maxima[key])) {
            throw new OperateError('E_OPERATE_CONFIG_INVALID', 'Custom profile caps exceed the supported safety bounds.');
        }
        normalized.caps = caps;
    }
    return normalized;
}
async function readOperatingPreferencesRecord(projectRoot, options = {}) {
    const paths = resolveOperatingPaths(projectRoot, { localRoot: options.localRoot });
    const raw = await readFile(path.join(paths.localRoot, 'preferences.json'), 'utf8').catch(() => null);
    if (raw === null)
        return null;
    try {
        return JSON.parse(raw);
    }
    catch {
        throw new OperateError('E_OPERATE_CONFIG_INVALID', 'Operating preferences.json is not valid JSON.');
    }
}
/**
 * Read the persisted per-project cadence `lastRunAt` marker (FR8 / E-008), or
 * `null` when no cycle has completed yet.
 */
export async function readOperatingLastRunAt(projectRoot, options = {}) {
    const preferences = await readOperatingPreferencesRecord(projectRoot, options);
    const value = preferences?.lastRunAt;
    return typeof value === 'string' && value.trim() ? value : null;
}
/**
 * Persist the per-project cadence `lastRunAt` marker into the machine-local
 * preferences atomically (temp + rename, mode 0o600). FR8 / E-008: recorded whenever a cycle reaches
 * reviewable/blocked/closed so `operate status` can surface the pipeline's
 * `nextDueAt` under an injected clock. `lastRunAt` is the injected cycle instant,
 * never a wall-clock read here. Requires an initialized project.
 */
export async function recordOperatingLastRunAt(input) {
    const preferences = await readOperatingPreferencesRecord(input.projectRoot, {
        localRoot: input.localRoot,
    });
    if (!preferences) {
        throw new OperateError('E_OPERATE_NOT_INITIALIZED', 'Operating Board is not initialized in this project; run `planr operate init` first.');
    }
    const next = { ...preferences, lastRunAt: input.lastRunAt };
    const paths = resolveOperatingPaths(input.projectRoot, { localRoot: input.localRoot });
    const preferencePath = path.join(paths.localRoot, 'preferences.json');
    const before = await readFile(preferencePath, 'utf8').catch(() => null);
    const serialized = `${canonicalize(next)}\n`;
    const changed = before !== serialized;
    if (changed) {
        await mkdir(paths.localRoot, { recursive: true, mode: 0o700 });
        const temporary = `${preferencePath}.${process.pid}.${randomUUID()}.tmp`;
        await writeFile(temporary, serialized, { mode: 0o600 });
        await rename(temporary, preferencePath);
    }
    return { lastRunAt: input.lastRunAt, changed };
}
/**
 * FR10 / T-008 default adapter session lease: 15 minutes. A prepared native
 * adapter session expires this long after `prepare`, and each successful `record`
 * refreshes the window forward from the moment the record lands. This was a
 * hardcoded constant in `maintenance.ts`; it is now the machine-local default,
 * overridable per project via `preferences.json`.
 */
export const DEFAULT_ADAPTER_LEASE_DURATION_MS = 15 * 60 * 1_000;
/** Bounded adapter-lease range: one minute to one hour. */
const MIN_ADAPTER_LEASE_DURATION_MS = 60 * 1_000;
const MAX_ADAPTER_LEASE_DURATION_MS = 60 * 60 * 1_000;
/**
 * Strictly validate an optional adapter-lease duration (milliseconds) before it is
 * echoed, persisted, or honored by the adapter lifecycle — mirroring the strict
 * operating-preference allowlisting pattern. The value must be
 * an integer within [1 minute, 60 minutes]. A non-integer or out-of-range value
 * fails closed with `E_OPERATE_CONFIG_INVALID` rather than silently clamping, so a
 * corrupt preference never quietly weakens or extends the lease.
 */
export function normalizeOperatingAdapterLeaseDurationMs(value) {
    if (typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < MIN_ADAPTER_LEASE_DURATION_MS ||
        value > MAX_ADAPTER_LEASE_DURATION_MS) {
        throw new OperateError('E_OPERATE_CONFIG_INVALID', `adapterLeaseDurationMs must be an integer from ${MIN_ADAPTER_LEASE_DURATION_MS} to ${MAX_ADAPTER_LEASE_DURATION_MS} milliseconds.`);
    }
    return value;
}
/**
 * Read the machine-local adapter-lease duration (milliseconds), or the 15-minute
 * default when unset. Machine-local, alongside `evidenceTtlMs`; a present value is
 * rejected rather than trusted.
 */
export async function readOperatingAdapterLeaseDurationMs(projectRoot, options = {}) {
    const preferences = await readOperatingPreferencesRecord(projectRoot, options);
    if (preferences?.adapterLeaseDurationMs === undefined) {
        return DEFAULT_ADAPTER_LEASE_DURATION_MS;
    }
    return normalizeOperatingAdapterLeaseDurationMs(preferences.adapterLeaseDurationMs);
}
export function normalizeCharter(input = {}) {
    const list = (values) => [
        ...new Set((values ?? []).map((value) => value.trim()).filter(Boolean)),
    ];
    return {
        purpose: input.purpose?.trim() ?? '',
        stage: input.stage?.trim() ?? '',
        businessModel: input.businessModel?.trim() ?? '',
        idealCustomer: input.idealCustomer?.trim() ?? '',
        goals: list(input.goals),
        constraints: list(input.constraints),
        successMetrics: list(input.successMetrics),
        guardrails: list(input.guardrails),
        knownUnknowns: list(input.knownUnknowns),
    };
}
/** Normalize already-validated questionnaire or explicit CLI answers once. */
export function normalizeOperatingInitializationAnswers(input) {
    const list = (values) => values === undefined
        ? undefined
        : [...new Set(values.map((value) => value.trim()).filter(Boolean))];
    return {
        ...(input.profile === undefined ? {} : { profile: input.profile }),
        ...(input.profileFile?.trim() ? { profileFile: input.profileFile.trim() } : {}),
        ...(input.decisionOwner?.trim() ? { decisionOwner: input.decisionOwner.trim() } : {}),
        ...(input.planningEngine === undefined ? {} : { planningEngine: input.planningEngine }),
        ...(input.runtime === undefined ? {} : { runtime: input.runtime }),
        ...(input.cadence === undefined ? {} : { cadence: input.cadence }),
        ...(input.timezone?.trim() ? { timezone: input.timezone.trim() } : {}),
        ...(input.sensitivityCeiling === undefined
            ? {}
            : { sensitivityCeiling: input.sensitivityCeiling }),
        ...(input.componentRoots === undefined
            ? {}
            : { componentRoots: list(input.componentRoots) ?? [] }),
        ...(input.charter === undefined ? {} : { charter: normalizeCharter(input.charter) }),
    };
}
function markdownList(values, fallback) {
    return values.length > 0 ? values.map((value) => `- ${value}`).join('\n') : `- ${fallback}`;
}
export function renderOperatingCharter(config, input = {}) {
    const charter = normalizeCharter(input);
    return [
        '# Operating charter',
        '',
        `Decision owner: ${config.decisionOwner}`,
        `Planning engine: ${config.planningEngine}`,
        `Profile: ${config.profile}`,
        '',
        '## Product context',
        '',
        `- Purpose: ${charter.purpose || '[unknown — answer before dependent routes]'}`,
        `- Stage: ${charter.stage || '[unknown]'}`,
        `- Business model: ${charter.businessModel || '[unknown]'}`,
        `- Ideal customer: ${charter.idealCustomer || '[unknown]'}`,
        '',
        '## Current goals',
        '',
        markdownList(charter.goals, '[unknown]'),
        '',
        '## Constraints',
        '',
        markdownList(charter.constraints, '[none recorded]'),
        '',
        '## Success metrics',
        '',
        markdownList(charter.successMetrics, '[unknown — numeric claims require a source and observation window]'),
        '',
        '## Guardrails',
        '',
        markdownList(charter.guardrails, 'No external or irreversible action without explicit human authority.'),
        '',
        '## Known unknowns',
        '',
        markdownList(charter.knownUnknowns, 'Complete the missing product context above.'),
    ].join('\n');
}
const INITIALIZATION_RECOVERY_ID = 'RCV-operating-board-initialized';
const INITIALIZATION_CORRELATION_ID = 'operate-initialization-v1';
// Protocol v1.3 (FR5/E-005) init layout: internals collapse under `.state/`
// (events.jsonl, records.jsonl, checkpoint.json). Fresh `operate init` writes
// this layout directly — there is no SPEC-002 tree to migrate for a new project.
const OPERATE_STATE_EVENTS = '.planr/operate/.state/events.jsonl';
const OPERATE_STATE_RECORDS = '.planr/operate/.state/records.jsonl';
const OPERATE_STATE_CHECKPOINT = '.planr/operate/.state/checkpoint.json';
async function buildInitialOperatingState(input) {
    const protocol = await loadOperatingProtocol();
    const genesis = { sequence: 0, hash: null };
    const recovery = {
        kind: 'operating-recovery-record',
        schemaVersion: OPERATE_SCHEMA_VERSION,
        protocolVersion: OPERATE_PROTOCOL_VERSION,
        id: INITIALIZATION_RECOVERY_ID,
        transactionId: null,
        action: 'rebuild-projection',
        reason: 'Operating Board initialized with a verified canonical event and checkpoint.',
        previewDigest: canonicalDigest({
            kind: 'operating-initialization',
            config: input.config,
            workspaceDigest: input.workspace.workspaceDigest,
        }),
        fromHead: genesis,
        // The recovery record is created before the event that references it. The
        // event and checkpoint carry the authoritative resulting hash.
        toHead: { sequence: 1, hash: null },
        outcome: 'recovered',
        confirmedBy: 'operate-cli',
        createdAt: input.createdAt,
    };
    await assertOperatingArtifact('operating-recovery-record', recovery);
    const contentDigest = canonicalDigest(recovery);
    const digest = canonicalDigest({
        recordType: 'recovery',
        createdAt: input.createdAt,
        correlationId: INITIALIZATION_CORRELATION_ID,
        contentDigest,
    });
    const record = {
        kind: 'operating-record',
        schemaVersion: OPERATE_SCHEMA_VERSION,
        protocolVersion: OPERATE_PROTOCOL_VERSION,
        digest,
        recordType: 'recovery',
        createdAt: input.createdAt,
        correlationId: INITIALIZATION_CORRELATION_ID,
        contentDigest,
        content: recovery,
    };
    await assertOperatingArtifact('operating-record', record);
    const event = protocol.createOperatingEvent({
        eventId: INITIALIZATION_CORRELATION_ID,
        timestamp: input.createdAt,
        cycleId: 'CYCLE-000',
        type: 'projection.rebuilt',
        entityId: INITIALIZATION_RECOVERY_ID,
        actor: { kind: 'engine', id: 'openplanr' },
        causationId: null,
        correlationId: INITIALIZATION_CORRELATION_ID,
        evidenceRefs: [],
        payload: { recordDigest: record.digest },
    }, { previousEvent: null, sequence: 1 });
    const state = protocol.reduceOperatingEvents([event]);
    const checkpoint = protocol.createOperatingCheckpoint(state, {
        createdAt: input.createdAt,
        recordDigests: [record.digest],
    });
    await Promise.all([
        assertOperatingArtifact('operating-event', event),
        assertOperatingArtifact('operating-state', state),
        assertOperatingArtifact('operating-checkpoint', checkpoint),
    ]);
    const projection = await prepareOperatingProjectionPersistence({
        projectRoot: input.projectRoot,
        state,
    });
    const projectionByPath = new Map(projection.files.map((file) => [file.relativePath, file]));
    const writes = [
        {
            relativePath: OPERATE_STATE_RECORDS,
            content: `${operatingRecordsLogLine(record)}\n`,
            operation: 'create',
        },
        {
            relativePath: OPERATE_STATE_CHECKPOINT,
            content: `${canonicalize(checkpoint)}\n`,
        },
        ...renderOperatingProjectionFiles(state).map((file) => ({
            relativePath: file.relativePath,
            content: projectionByPath.get(file.relativePath)?.content ?? file.content,
        })),
        // Keep the canonical event last: journal head revalidation remains at
        // genesis for every preceding write, then changes exactly once.
        {
            relativePath: OPERATE_STATE_EVENTS,
            content: `${canonicalize(event)}\n`,
            operation: 'create',
        },
    ];
    return { event, record, checkpoint, state, writes };
}
export async function prepareOperatingInitialization(input) {
    if (!input.decisionOwner.trim()) {
        throw new OperateError('E_OPERATE_CONFIG_INVALID', 'Operating initialization requires a decision owner.');
    }
    const base = getOperatingProfile(input.profile);
    const customProfile = input.profile === 'custom'
        ? normalizeCustomOperatingProfile(input.customProfile ?? {})
        : undefined;
    const selected = input.profile === 'custom'
        ? {
            ...base,
            ...customProfile,
            caps: { ...base.caps, ...customProfile?.caps },
        }
        : base;
    const config = {
        kind: 'operating-config',
        schemaVersion: OPERATE_SCHEMA_VERSION,
        protocolVersion: OPERATE_PROTOCOL_VERSION,
        profile: input.profile,
        decisionOwner: input.decisionOwner.trim(),
        cadence: input.cadence ?? 'manual',
        planningEngine: input.planningEngine,
        enabledRoles: [...selected.enabledRoles],
        enabledProviders: [...FROZEN_OPERATING_PROVIDERS],
        caps: { ...selected.caps },
        budgets: { ...FROZEN_OPERATING_BUDGETS },
    };
    const caps = config.caps;
    const capBounds = [
        ['surfacedFindings', 50],
        ['newSpecs', 12],
        ['openDecisions', 20],
        ['agentArtifacts', 20],
    ];
    for (const [name, maximum] of capBounds) {
        if (!Number.isInteger(caps[name]) || caps[name] < 1 || caps[name] > maximum) {
            throw new OperateError('E_OPERATE_CONFIG_INVALID', `${name} must be an integer from 1 to ${maximum}.`);
        }
    }
    await assertOperatingArtifact('operating-config', config);
    const timezone = input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    try {
        new Intl.DateTimeFormat('en', { timeZone: timezone }).format(new Date(0));
    }
    catch {
        throw new OperateError('E_OPERATE_CONFIG_INVALID', `Invalid IANA timezone: ${timezone}.`);
    }
    const evidenceTtlMs = input.evidenceTtlMs ?? 7 * 24 * 60 * 60 * 1000;
    if (!Number.isInteger(evidenceTtlMs) ||
        evidenceTtlMs < 60 * 60 * 1_000 ||
        evidenceTtlMs > 30 * 24 * 60 * 60 * 1_000) {
        throw new OperateError('E_OPERATE_CONFIG_INVALID', 'Evidence TTL must be between one hour and 30 days.');
    }
    const componentRoots = [...new Set(input.componentRoots ?? [])];
    let workspace = await buildWorkspaceManifest(input.projectRoot, componentRoots, {
        capturedAt: input.now,
        localRoot: input.localRoot,
        persistRoots: false,
    });
    const paths = resolveOperatingPaths(input.projectRoot, { localRoot: input.localRoot });
    // FR5 / T-005: read the existing machine-local preferences before rebuilding the
    // record so policy a prior cycle persisted survives a routine re-init instead of
    // being silently wiped. The same raw read drives both the merge below and the
    // `preferencesChanged` byte-diff further down. A corrupt file is treated as
    // absent — there is nothing safe to carry forward — preserving the pre-fix
    // "overwrite an unreadable preferences.json" behavior rather than hard-failing.
    const currentPreferences = await readFile(path.join(paths.localRoot, 'preferences.json'), 'utf8').catch(() => null);
    let existingPreferences = null;
    if (currentPreferences !== null) {
        try {
            existingPreferences = JSON.parse(currentPreferences);
        }
        catch {
            existingPreferences = null;
        }
    }
    // Adapter lease duration and the cadence `lastRunAt` marker have no init flag, so
    // absent an explicit input they always carry forward from the existing file. A
    // carried-forward lease is re-validated so a corrupt bound is rejected rather than
    // silently trusted; a blank/absent `lastRunAt` is dropped exactly as the reader does.
    const adapterLeaseDurationMs = input.adapterLeaseDurationMs !== undefined
        ? normalizeOperatingAdapterLeaseDurationMs(input.adapterLeaseDurationMs)
        : existingPreferences?.adapterLeaseDurationMs !== undefined
            ? normalizeOperatingAdapterLeaseDurationMs(existingPreferences.adapterLeaseDurationMs)
            : undefined;
    const carriedLastRunAt = input.lastRunAt !== undefined ? input.lastRunAt : existingPreferences?.lastRunAt;
    const lastRunAt = typeof carriedLastRunAt === 'string' && carriedLastRunAt.trim() ? carriedLastRunAt : undefined;
    const preferences = {
        runtime: input.runtime ?? 'auto',
        timezone,
        sensitivityCeiling: input.sensitivityCeiling ?? 'internal',
        evidenceTtlMs,
        enabledSources: [...config.enabledProviders],
        ...(adapterLeaseDurationMs !== undefined ? { adapterLeaseDurationMs } : {}),
        ...(lastRunAt !== undefined ? { lastRunAt } : {}),
    };
    const existingWorkspace = await readFile(paths.workspace, 'utf8')
        .then(async (raw) => {
        const parsed = JSON.parse(raw);
        await assertOperatingArtifact('operating-workspace-manifest', parsed);
        return parsed;
    })
        .catch(() => null);
    if (existingWorkspace &&
        existingWorkspace.workspaceDigest === workspace.workspaceDigest &&
        canonicalDigest(existingWorkspace.controlRepository) ===
            canonicalDigest(workspace.controlRepository) &&
        canonicalDigest(existingWorkspace.components) === canonicalDigest(workspace.components)) {
        // Repeated init must be byte-idempotent. Preserve the original capture
        // time when the verified repository descriptors have not changed.
        workspace = existingWorkspace;
    }
    const expectedPreferences = `${canonicalize(preferences)}\n`;
    const preferencesChanged = currentPreferences !== expectedPreferences;
    // FR5 / T-005: name exactly which top-level preference keys differ between the
    // existing file and the record about to be written, so the init preview can tell
    // the operator what will change before they confirm. Derived from the same two
    // records the byte-diff above uses; it deliberately never feeds the preview or
    // confirmation digest, so the unchanged-case digest binding stays byte-identical.
    const existingRecord = (existingPreferences ?? {});
    const nextRecord = preferences;
    const changedPreferenceKeys = [
        ...new Set([...Object.keys(existingRecord), ...Object.keys(nextRecord)]),
    ]
        .filter((key) => Object.hasOwn(existingRecord, key) !== Object.hasOwn(nextRecord, key)
        ? true
        : canonicalize(existingRecord[key]) !== canonicalize(nextRecord[key]))
        .sort();
    const existingCharter = await readFile(paths.charter, 'utf8').catch(() => '');
    const charter = spliceManagedBlock(existingCharter, 'operate-charter', renderOperatingCharter(config, input.charter));
    const writes = [
        { relativePath: '.planr/operate/config.json', content: `${canonicalize(config)}\n` },
        { relativePath: '.planr/operate/charter.md', content: charter },
        { relativePath: '.planr/operate/workspace.json', content: `${canonicalize(workspace)}\n` },
    ];
    const existingEvents = await readFile(paths.events, 'utf8').catch((error) => {
        if (error.code === 'ENOENT')
            return '';
        throw error;
    });
    let expectedEventHead = { sequence: 0, hash: null };
    let resultingEventHead = { sequence: 0, hash: null };
    if (existingEvents.trim()) {
        const replay = await new OperatingEventStore(input.projectRoot, {
            localRoot: input.localRoot,
        }).replay();
        expectedEventHead = replay.eventHead;
        resultingEventHead = replay.eventHead;
    }
    else {
        const initial = await buildInitialOperatingState({
            projectRoot: input.projectRoot,
            createdAt: workspace.capturedAt,
            config,
            workspace,
        });
        resultingEventHead = {
            sequence: initial.event.sequence,
            hash: initial.event.eventHash,
        };
        writes.push(...initial.writes);
    }
    const changedPaths = [];
    for (const write of writes) {
        const current = await readFile(path.join(input.projectRoot, write.relativePath)).catch(() => null);
        const next = Buffer.from(write.content);
        if (!current || sha256Digest(current) !== sha256Digest(next)) {
            changedPaths.push(write.relativePath);
        }
    }
    const exactWrites = writes.map((write) => ({
        relativePath: write.relativePath,
        operation: write.operation ?? 'replace',
        contentDigest: sha256Digest(write.content),
    }));
    const previewDigest = canonicalDigest({
        config,
        preferences,
        charterDigest: sha256Digest(charter),
        workspaceDigest: workspace.workspaceDigest,
        expectedEventHead,
        resultingEventHead,
        exactWrites,
        changedPaths,
        preferencesChanged,
    });
    // FR9 / T-005: name the project's actual git tracking status for `.planr/` so
    // init tells the operator plainly whether the sanitized board will be
    // versioned. Purely informational — it is deliberately not folded into
    // `previewDigest`, so the confirmation binding stays byte-identical.
    const workspaceVersioning = await detectGitignoredWorkspace(input.projectRoot);
    return {
        config,
        preferences,
        charter,
        workspace,
        previewDigest,
        changedPaths,
        preferencesChanged,
        changedPreferenceKeys,
        workspaceVersioning,
        writes,
        componentRoots,
        expectedEventHead,
        resultingEventHead,
    };
}
export async function applyOperatingInitialization(input) {
    if (input.confirmationDigest !== input.preview.previewDigest) {
        throw new OperateError('E_OPERATE_ROUTE_CONFIRMATION_REQUIRED', 'Initialization requires confirmation of the exact preview digest.');
    }
    const currentWorkspace = await buildWorkspaceManifest(input.projectRoot, input.preview.componentRoots, {
        capturedAt: input.preview.workspace.capturedAt,
        localRoot: input.localRoot,
        persistRoots: false,
    });
    if (currentWorkspace.workspaceDigest !== input.preview.workspace.workspaceDigest) {
        throw new OperateError('E_OPERATE_ROUTE_DRIFT', 'Workspace revisions changed after initialization preview.');
    }
    const paths = await ensureOperatingDirectories(input.projectRoot, {
        localRoot: input.localRoot,
    });
    const store = new OperatingEventStore(input.projectRoot, { localRoot: input.localRoot });
    const initial = await store.replay();
    if (initial.eventHead.sequence !== input.preview.expectedEventHead.sequence ||
        initial.eventHead.hash !== input.preview.expectedEventHead.hash) {
        throw new OperateError('E_OPERATE_ROUTE_DRIFT', 'Operating state changed after initialization preview.', {
            changedDimensions: ['eventHead'],
            expectedEventHead: input.preview.expectedEventHead,
            currentEventHead: initial.eventHead,
        });
    }
    await withOperatingLock(input.projectRoot, {
        projectKey: operatingProjectKey(input.projectRoot),
        expectedEventHead: input.preview.expectedEventHead,
        currentEventHead: initial.eventHead,
        localRoot: input.localRoot,
    }, async (lock) => {
        const preferencePath = path.join(paths.localRoot, 'preferences.json');
        const beforeRoots = await readFile(paths.roots).catch(() => null);
        const beforePreferences = await readFile(preferencePath).catch(() => null);
        const restorePrivate = async () => {
            for (const [target, before] of [
                [paths.roots, beforeRoots],
                [preferencePath, beforePreferences],
            ]) {
                if (before)
                    await writeFile(target, before, { mode: 0o600 });
                else
                    await unlink(target).catch(() => undefined);
            }
        };
        const journal = input.preview.changedPaths.length > 0
            ? await prepareJournalTransaction(input.projectRoot, {
                writes: input.preview.writes.filter((write) => input.preview.changedPaths.includes(write.relativePath)),
                eventHead: initial.eventHead,
                previewDigest: input.preview.previewDigest,
                localRoot: input.localRoot,
            })
            : null;
        let advancedHead = false;
        try {
            if (journal)
                await input.faultInjector?.('journal-prepared');
            if (journal) {
                await applyJournalTransaction(input.projectRoot, journal, {
                    currentEventHead: initial.eventHead,
                    revalidateEventHead: async () => (await store.replay()).eventHead,
                });
                await input.faultInjector?.('project-promoted');
                if (input.preview.resultingEventHead.sequence !== initial.eventHead.sequence ||
                    input.preview.resultingEventHead.hash !== initial.eventHead.hash) {
                    const actual = (await store.replay()).eventHead;
                    if (actual.sequence !== input.preview.resultingEventHead.sequence ||
                        actual.hash !== input.preview.resultingEventHead.hash) {
                        throw new OperateError('E_OPERATE_HEAD_DIVERGED', 'Initialization did not produce the confirmed canonical event head.');
                    }
                    await lock.advanceEventHead(initial.eventHead, actual);
                    advancedHead = true;
                }
            }
            await input.faultInjector?.('workspace-roots');
            await buildWorkspaceManifest(input.projectRoot, input.preview.componentRoots, {
                capturedAt: input.preview.workspace.capturedAt,
                localRoot: input.localRoot,
                persistRoots: true,
            });
            await input.faultInjector?.('preferences');
            await mkdir(paths.localRoot, { recursive: true, mode: 0o700 });
            const temporary = `${preferencePath}.${process.pid}.${randomUUID()}.tmp`;
            await writeFile(temporary, `${canonicalize(input.preview.preferences)}\n`, { mode: 0o600 });
            await rename(temporary, preferencePath);
            await input.faultInjector?.('committed');
        }
        catch (error) {
            await restorePrivate().catch(() => undefined);
            if (journal) {
                await rollbackJournalTransaction(input.projectRoot, journal).catch(() => undefined);
            }
            if (advancedHead) {
                await lock
                    .advanceEventHead(input.preview.resultingEventHead, initial.eventHead)
                    .catch(() => undefined);
            }
            throw error;
        }
    });
    return {
        initialized: input.preview.changedPaths.length > 0 || input.preview.preferencesChanged,
        changedPaths: [...input.preview.changedPaths],
    };
}
export async function validateOperatingConfiguration(projectRoot) {
    const paths = resolveOperatingPaths(projectRoot);
    let config;
    try {
        config = JSON.parse(await readFile(paths.config, 'utf8'));
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            throw new OperateError('E_OPERATE_NOT_INITIALIZED', 'Operating Board is not initialized for this project.', { recoveryCommand: 'planr operate init' });
        }
        throw new OperateError('E_OPERATE_CONFIG_INVALID', 'Operating Board configuration is not valid JSON.');
    }
    await assertOperatingArtifact('operating-config', config);
    const protocol = await loadOperatingProtocol();
    const knownRoles = new Set(protocol.listOperatingRoles().map((entry) => entry.id));
    const knownProviders = new Set(protocol.listOperatingProviders().map((entry) => entry.id));
    if (config.enabledRoles.some((role) => !knownRoles.has(role))) {
        throw new OperateError('E_OPERATE_CONFIG_INVALID', 'Configuration has an unknown role.');
    }
    if (config.enabledProviders.some((provider) => !knownProviders.has(provider))) {
        throw new OperateError('E_OPERATE_CONFIG_INVALID', 'Configuration has an unknown provider.');
    }
    return config;
}
export function operatingProjectKey(projectRoot) {
    return `operate-${projectMachineKey(projectRoot)}`;
}
//# sourceMappingURL=config.js.map