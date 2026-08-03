/**
 * Linear → OpenPlanr: sync workflow state names into Feature and Story `status` frontmatter (FEAT-017).
 */
import { isVerbose, logger } from '../utils/logger.js';
import { listArtifacts, readArtifact, updateArtifactFields } from './artifact-service.js';
import { fetchLinearIssueStateNames, isLikelyLinearWorkflowStateId } from './linear-service.js';
function asTaskStatus(s) {
    if (s === 'pending' || s === 'in-progress' || s === 'done')
        return s;
    return 'pending';
}
function normalizeStateKey(name) {
    return name.trim().toLowerCase();
}
/**
 * Default Linear workflow state name → OpenPlanr `TaskStatus` (case-insensitive keys).
 * User `linear.statusMap` overrides/extends these.
 */
const DEFAULT_LINEAR_STATE_TO_OP = [
    ['backlog', 'pending'],
    ['triage', 'pending'],
    ['unstarted', 'pending'],
    ['todo', 'pending'],
    ['canceled', 'done'],
    ['cancelled', 'done'],
    ['done', 'done'],
    ['completed', 'done'],
    ['in progress', 'in-progress'],
    ['in development', 'in-progress'],
    ['in review', 'in-progress'],
];
export function buildNameToStatusMap(user) {
    const m = new Map();
    for (const [k, v] of DEFAULT_LINEAR_STATE_TO_OP) {
        m.set(normalizeStateKey(k), v);
    }
    if (user) {
        for (const [linearName, raw] of Object.entries(user)) {
            if (isLikelyLinearWorkflowStateId(raw))
                continue;
            if (raw === 'pending' || raw === 'in-progress' || raw === 'done') {
                m.set(normalizeStateKey(linearName), raw);
            }
        }
    }
    return m;
}
export function mapLinearNameToTaskStatus(stateName, byName) {
    return byName.get(normalizeStateKey(stateName));
}
export async function syncLinearStatusIntoArtifacts(projectDir, config, client, options) {
    const dryRun = options?.dryRun === true;
    const summary = {
        updated: 0,
        unchanged: 0,
        unmapped: 0,
        skippedNoId: 0,
        missingFromApi: 0,
    };
    const byName = buildNameToStatusMap(config.linear?.statusMap);
    const tracked = [];
    for (const type of ['feature', 'story']) {
        const list = await listArtifacts(projectDir, config, type);
        for (const row of list) {
            const art = await readArtifact(projectDir, config, type, row.id);
            if (!art)
                continue;
            const linearId = art.data.linearIssueId;
            if (!linearId) {
                logger.debug(`linear sync: skip ${row.id} (no linearIssueId in frontmatter)`);
                summary.skippedNoId++;
                continue;
            }
            const localStatus = asTaskStatus(art.data.status);
            tracked.push({ type, id: row.id, linearIssueId: linearId, localStatus });
        }
    }
    if (tracked.length === 0) {
        return summary;
    }
    const ids = tracked.map((t) => t.linearIssueId);
    const fromLinear = await fetchLinearIssueStateNames(client, ids);
    for (const t of tracked) {
        const stateName = fromLinear.get(t.linearIssueId);
        if (stateName === undefined) {
            logger.warn(`linear sync: issue ${t.linearIssueId} (${t.type} ${t.id}) not returned by Linear (deleted or no access) — left unchanged.`);
            summary.missingFromApi++;
            continue;
        }
        const mapped = mapLinearNameToTaskStatus(stateName, byName);
        if (mapped === undefined) {
            logger.warn(`linear sync: unmapped Linear state "${stateName}" for ${t.type} ${t.id} — left unchanged.`);
            summary.unmapped++;
            continue;
        }
        if (mapped === t.localStatus) {
            if (isVerbose()) {
                logger.debug(`linear sync: ${t.type} ${t.id} unchanged (${mapped})`);
            }
            summary.unchanged++;
            continue;
        }
        if (!dryRun) {
            await updateArtifactFields(projectDir, config, t.type, t.id, { status: mapped });
        }
        if (isVerbose()) {
            logger.debug(`linear sync: ${t.type} ${t.id} status ${t.localStatus} → ${mapped} (Linear: "${stateName}")`);
        }
        summary.updated++;
    }
    return summary;
}
export function formatLinearStatusSyncLine(s) {
    return `${s.updated} status update(s), ${s.unchanged} unchanged, ${s.unmapped} unmapped, ${s.skippedNoId} skipped (no linearIssueId), ${s.missingFromApi} not returned by API`;
}
//# sourceMappingURL=linear-status-sync-service.js.map