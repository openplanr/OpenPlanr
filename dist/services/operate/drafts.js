import { randomUUID } from 'node:crypto';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { slugify } from '../../utils/slugify.js';
import { loadConfig } from '../config-service.js';
import { renderTemplate } from '../template-service.js';
import { canonicalDigest, canonicalize, sha256Digest } from './canonical.js';
import { validateOperatingConfiguration } from './config.js';
import { OperatingEventStore } from './event-store.js';
import { applyJournalTransaction, prepareJournalTransaction, readJournal, rollbackJournalTransaction, } from './journal.js';
import { readPersistedOperatingAdvisorReports } from './maintenance.js';
import { resolveOperatingPipelineRoot } from './protocol.js';
import { sanitizeGeneratedPlainText } from './redaction.js';
import { OperateError } from './types.js';
import { resolveOperatingPaths } from './workspace.js';
let cachedApi = null;
async function draftApi() {
    cachedApi ??= (async () => {
        const root = resolveOperatingPipelineRoot({ requireMission: true });
        if (!root) {
            throw new OperateError('E_PIPELINE_VERSION_INCOMPATIBLE', 'Operating drafts require planr-pipeline with Protocol v1.4.');
        }
        return (await import(pathToFileURL(path.join(root, 'lib', 'operate', 'drafts.mjs')).href));
    })();
    return cachedApi;
}
function draftsDirectory(projectRoot) {
    return path.join(resolveOperatingPaths(projectRoot).root, 'drafts');
}
function storedDraftPath(projectRoot, draftId) {
    return path.join(draftsDirectory(projectRoot), `${draftId}.json`);
}
function relativeStoredDraftPath(draftId) {
    return `.planr/operate/drafts/${draftId}.json`;
}
async function exists(target) {
    return access(target).then(() => true, () => false);
}
async function readStoredDraft(target) {
    const parsed = JSON.parse(await readFile(target, 'utf8'));
    if (parsed.version !== '1.0.0' || !parsed.draft?.draftId || !parsed.transactionId) {
        throw new OperateError('E_OPERATE_STATE_INVALID', `Invalid operating draft record: ${target}`);
    }
    return parsed;
}
export async function listOperatingDrafts(projectRoot) {
    const names = (await readdir(draftsDirectory(projectRoot)).catch(() => []))
        .filter((name) => /^DRAFT-[A-Za-z0-9._-]+\.json$/.test(name))
        .sort();
    return Promise.all(names.map((name) => readStoredDraft(path.join(draftsDirectory(projectRoot), name))));
}
export async function showOperatingDraft(projectRoot, draftId) {
    const target = storedDraftPath(projectRoot, draftId);
    if (!(await exists(target))) {
        throw new OperateError('E_OPERATE_STATE_INVALID', `Unknown operating draft ${draftId}.`);
    }
    return readStoredDraft(target);
}
function normalized(value) {
    return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}
function findingIdsForAction(findings, action) {
    const title = normalized(action.title);
    const summary = normalized(action.summary);
    return findings
        .filter((finding) => normalized(finding.title) === title ||
        normalized(finding.proposal) === summary ||
        normalized(finding.problem) === summary)
        .map((finding) => finding.id)
        .sort();
}
function nextOrdinal(entries, prefix) {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const expression = new RegExp(`^${escaped}-(\\d{3})(?:-|\\.)`);
    const used = new Set(entries
        .map((entry) => entry.match(expression)?.[1])
        .filter((value) => Boolean(value))
        .map(Number));
    let ordinal = 1;
    while (used.has(ordinal))
        ordinal += 1;
    return ordinal;
}
function proposalNotice(cycleId, draftId) {
    return [
        '> [!IMPORTANT]',
        `> **Operate proposal — ${draftId}.** Generated from ${cycleId}.`,
        '> This is a reversible, unapproved draft. Review with `planr operate drafts show` and approve it before PLAN or SHIP.',
        '',
    ].join('\n');
}
function insertAfterFrontmatter(content, notice) {
    const end = content.indexOf('\n---\n', 4);
    if (!content.startsWith('---\n') || end < 0)
        return `${notice}${content}`;
    const offset = end + '\n---\n'.length;
    return `${content.slice(0, offset)}\n${notice}${content.slice(offset)}`;
}
async function directoryEntries(projectRoot, relative) {
    return readdir(path.join(projectRoot, relative)).catch(() => []);
}
async function renderDraftArtifact(input) {
    const title = sanitizeGeneratedPlainText(input.action.title);
    const summary = sanitizeGeneratedPlainText(input.action.summary);
    const slug = slugify(title) || `operate-${input.ordinal}`;
    const sequence = String(input.ordinal).padStart(3, '0');
    const date = new Date().toISOString().slice(0, 10);
    const notice = proposalNotice(input.cycleId, input.draftId);
    if (input.action.routeKind === 'quick-task') {
        const id = `${input.prefixes.quick}-${sequence}`;
        const content = await renderTemplate('quick/quick-task.md.hbs', {
            id,
            title,
            date,
            tasks: [{ id: '1.0', title: summary, subtasks: [] }],
        });
        return {
            path: `.planr/quick/${id}-${slug}.md`,
            content: insertAfterFrontmatter(content, notice),
        };
    }
    if (input.action.routeKind === 'spec') {
        const id = `${input.prefixes.spec}-${sequence}`;
        const directory = `.planr/specs/${id}-${slug}`;
        const content = await renderTemplate('spec/spec.md.hbs', {
            id,
            slug,
            title,
            schemaVersion: '1.0.0',
            status: 'pending',
            priority: 'P1',
            date,
            projectName: input.projectName,
        });
        const shaped = insertAfterFrontmatter(content, notice).replace('_Describe the problem this feature solves and the expected outcome. 2-5 sentences. Focus on the user need; avoid implementation details._', summary);
        return {
            path: `${directory}/${id}-${slug}.md`,
            content: shaped,
            extraWrites: [{ path: `${directory}/design/.gitkeep`, content: '' }],
        };
    }
    if (input.action.routeKind === 'epic') {
        const id = `${input.prefixes.epic}-${sequence}`;
        const content = await renderTemplate('epics/epic.md.hbs', {
            id,
            title,
            owner: input.decisionOwner,
            date,
            projectName: input.projectName,
            businessValue: summary,
            targetUsers: 'Users and operators identified by the cited Operating Board analysis.',
            problemStatement: summary,
            solutionOverview: summary,
            successCriteriaList: [`Review and decompose the cited ${input.cycleId} recommendation.`],
            keyFeatures: [summary],
            dependencies: `Operating Board ${input.cycleId}; draft ${input.draftId}.`,
            risks: 'This proposal remains unapproved and cannot enter PLAN or SHIP.',
            featureIds: [],
        });
        return {
            path: `.planr/epics/${id}-${slug}.md`,
            content: insertAfterFrontmatter(content.replace('status: "planning"', 'status: "pending"'), notice),
        };
    }
    const root = input.action.routeKind === 'decision'
        ? '.planr/operate/decisions'
        : `.planr/operate/cycles/${input.cycleId}/artifacts`;
    const prefix = input.action.routeKind === 'decision' ? 'DECISION' : 'AGENT';
    return {
        path: `${root}/${prefix}-${sequence}-${slug}.md`,
        content: [
            '---',
            `id: ${JSON.stringify(`${prefix}-${sequence}`)}`,
            `title: ${JSON.stringify(title)}`,
            'status: "pending"',
            `cycleId: ${JSON.stringify(input.cycleId)}`,
            `draftId: ${JSON.stringify(input.draftId)}`,
            '---',
            '',
            notice.trimEnd(),
            '',
            `# ${title}`,
            '',
            summary,
            '',
            '## Required review',
            '',
            input.action.routeKind === 'decision'
                ? `Decision owner: ${input.decisionOwner}.`
                : 'Approve this research/content brief before an agent executes it.',
            '',
        ].join('\n'),
    };
}
function ordinalRoot(kind) {
    if (kind === 'quick-task')
        return '.planr/quick';
    if (kind === 'spec')
        return '.planr/specs';
    if (kind === 'epic')
        return '.planr/epics';
    if (kind === 'decision')
        return '.planr/operate/decisions';
    return '.planr/operate/cycles';
}
export async function materializeOperatingDrafts(input) {
    const [api, config, openPlanrConfig, store] = await Promise.all([
        draftApi(),
        validateOperatingConfiguration(input.projectRoot),
        loadConfig(input.projectRoot).catch(() => null),
        Promise.resolve(new OperatingEventStore(input.projectRoot)),
    ]);
    const state = await store.state();
    const cycle = state.cycles.find((candidate) => candidate.id === input.cycleId);
    if (!cycle || !['reviewable', 'closed'].includes(cycle.state)) {
        throw new OperateError('E_OPERATE_STATE_INVALID', `Cycle ${input.cycleId} must be reviewable before proposals can be materialized.`);
    }
    const reports = await readPersistedOperatingAdvisorReports(store, input.cycleId);
    const chair = reports.get('chair');
    const actions = (chair?.actions?.length
        ? chair.actions
        : [...reports.entries()]
            .filter(([roleId]) => roleId !== 'chair')
            .flatMap(([, report]) => report.actions));
    const stored = await listOperatingDrafts(input.projectRoot);
    const qualified = api.qualifyOperatingDraftCandidates(actions, {
        existingDigests: stored.map((entry) => entry.candidateDigest),
        conflictedActionKeys: (chair?.conflicts ?? []).flatMap((conflict) => conflict.actionKeys),
        capacity: config.caps.surfacedFindings +
            config.caps.newSpecs +
            config.caps.openDecisions +
            config.caps.agentArtifacts,
    });
    const created = [];
    const existing = stored
        .filter((entry) => actions.some((action) => action.actionKey === entry.draft.actionKey))
        .map((entry) => entry.draft);
    const rejected = qualified.rejected.map((entry) => ({
        actionKey: entry.action.actionKey,
        reason: entry.reason,
    }));
    const reservations = new Map();
    for (const candidate of qualified.eligible) {
        const findingIds = findingIdsForAction(state.findings.filter((finding) => finding.cycleId === input.cycleId), candidate.action);
        if (findingIds.length === 0) {
            rejected.push({ actionKey: candidate.action.actionKey, reason: 'no-governed-finding' });
            continue;
        }
        const kind = candidate.action.routeKind;
        const root = ordinalRoot(kind);
        const prefix = kind === 'quick-task'
            ? (openPlanrConfig?.idPrefix.quick ?? 'QT')
            : kind === 'spec'
                ? (openPlanrConfig?.idPrefix.spec ?? 'SPEC')
                : kind === 'epic'
                    ? (openPlanrConfig?.idPrefix.epic ?? 'EPIC')
                    : kind === 'decision'
                        ? 'DECISION'
                        : 'AGENT';
        const reservationKey = `${root}:${prefix}`;
        const ordinal = reservations.get(reservationKey) ??
            nextOrdinal(await directoryEntries(input.projectRoot, root), prefix);
        reservations.set(reservationKey, ordinal + 1);
        const draftId = `DRAFT-${input.cycleId.slice('CYCLE-'.length)}-${slugify(candidate.action.actionKey, 48)}-${candidate.digest.slice(-8)}`;
        const rendered = await renderDraftArtifact({
            projectRoot: input.projectRoot,
            cycleId: input.cycleId,
            draftId,
            action: candidate.action,
            ordinal,
            decisionOwner: config.decisionOwner,
            projectName: openPlanrConfig?.projectName ?? path.basename(input.projectRoot),
            prefixes: {
                quick: openPlanrConfig?.idPrefix.quick ?? 'QT',
                spec: openPlanrConfig?.idPrefix.spec ?? 'SPEC',
                epic: openPlanrConfig?.idPrefix.epic ?? 'EPIC',
            },
        });
        const artifactDigest = sha256Digest(rendered.content);
        const draft = api.createOperatingMaterializedDraft({
            draftId,
            cycleId: input.cycleId,
            actionKey: candidate.action.actionKey,
            artifactKind: kind,
            path: rendered.path,
            status: 'proposed',
            artifactDigest,
            findingIds,
            citationDigests: candidate.action.citations.map((citation) => canonicalDigest(citation)),
        });
        const transactionId = `TXN-OPERATE-DRAFT-${randomUUID()}`;
        const now = new Date().toISOString();
        const storedRecord = {
            version: '1.0.0',
            candidateDigest: candidate.digest,
            transactionId,
            draft,
            createdAt: now,
            updatedAt: now,
        };
        const writes = [
            { relativePath: rendered.path, operation: 'create', content: rendered.content },
            ...(rendered.extraWrites ?? []).map((write) => ({
                relativePath: write.path,
                operation: 'create',
                content: write.content,
            })),
            {
                relativePath: relativeStoredDraftPath(draftId),
                operation: 'create',
                content: `${canonicalize(storedRecord)}\n`,
            },
        ];
        const head = (await store.replay()).eventHead;
        const prepared = await prepareJournalTransaction(input.projectRoot, {
            writes,
            eventHead: head,
            previewDigest: canonicalDigest({ draft, writes: writes.map((write) => write.relativePath) }),
            transactionId,
        });
        await applyJournalTransaction(input.projectRoot, prepared, {
            currentEventHead: head,
            revalidateEventHead: async () => (await store.replay()).eventHead,
        });
        created.push(draft);
    }
    return { created, existing, rejected };
}
async function replaceStoredDraft(projectRoot, stored, nextDraft) {
    const store = new OperatingEventStore(projectRoot);
    const head = (await store.replay()).eventHead;
    const next = { ...stored, draft: nextDraft, updatedAt: new Date().toISOString() };
    const prepared = await prepareJournalTransaction(projectRoot, {
        writes: [
            {
                relativePath: relativeStoredDraftPath(nextDraft.draftId),
                operation: 'replace',
                content: `${canonicalize(next)}\n`,
            },
        ],
        eventHead: head,
        previewDigest: canonicalDigest(next),
    });
    await applyJournalTransaction(projectRoot, prepared, {
        currentEventHead: head,
        revalidateEventHead: async () => (await store.replay()).eventHead,
    });
    return next;
}
export async function approveOperatingDraft(projectRoot, draftId) {
    const stored = await showOperatingDraft(projectRoot, draftId);
    if (stored.draft.status === 'discarded') {
        throw new OperateError('E_OPERATE_STATE_INVALID', `Draft ${draftId} was discarded.`);
    }
    const current = await readFile(path.join(projectRoot, stored.draft.path));
    const nextDraft = {
        ...stored.draft,
        status: 'approved',
        ...(sha256Digest(current) === stored.draft.artifactDigest ? {} : { userEdited: true }),
    };
    (await draftApi()).assertOperatingDraftApproved(nextDraft);
    return replaceStoredDraft(projectRoot, stored, nextDraft);
}
export async function discardOperatingDraft(projectRoot, draftId) {
    const stored = await showOperatingDraft(projectRoot, draftId);
    if (stored.draft.status === 'approved') {
        throw new OperateError('E_OPERATE_STATE_INVALID', `Approved draft ${draftId} cannot be discarded automatically. Revert its approved work explicitly.`);
    }
    const artifact = await readFile(path.join(projectRoot, stored.draft.path)).catch(() => null);
    const userEdited = Boolean(artifact && sha256Digest(artifact) !== stored.draft.artifactDigest);
    const discarded = {
        ...stored.draft,
        status: 'discarded',
        ...(userEdited ? { userEdited: true } : {}),
    };
    if (userEdited) {
        await replaceStoredDraft(projectRoot, stored, discarded);
        return { discarded, artifactPreserved: true };
    }
    const root = path.join(resolveOperatingPaths(projectRoot).transactions, stored.transactionId);
    const manifestPath = path.join(root, 'journal.json');
    const record = await readJournal(manifestPath);
    await rollbackJournalTransaction(projectRoot, { root, manifestPath, record });
    return { discarded, artifactPreserved: false };
}
export async function assertOperatingDraftTargetApproved(projectRoot, target) {
    const normalizedTarget = target.toLowerCase();
    for (const stored of await listOperatingDrafts(projectRoot)) {
        const draft = stored.draft;
        if (draft.status === 'proposed' &&
            (draft.path.toLowerCase().includes(normalizedTarget) ||
                path.basename(draft.path).toLowerCase().includes(normalizedTarget))) {
            throw new OperateError('E_OPERATE_DRAFT_UNAPPROVED', `Draft ${draft.draftId} is proposed and cannot enter PLAN or SHIP.`, { approvalCommand: `planr operate drafts approve ${draft.draftId}` });
        }
    }
}
//# sourceMappingURL=drafts.js.map