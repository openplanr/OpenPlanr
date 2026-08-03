/**
 * Local-only Linear ↔ OpenPlanr mapping table for `planr linear status`.
 */
import { listArtifacts, readArtifact } from './artifact-service.js';
import { buildCascadeOrder } from './cascade-service.js';
import { isLikelyLinearIssueId } from './linear-service.js';
/**
 * Flag frontmatter values that don't parse as a plausible Linear issue id —
 * typos like `ENG42` (no hyphen), truncations, or values copied from other
 * tools. Linear issue ids accept two legitimate shapes: UUID v4 (canonical
 * API form) and `ENG-42` identifier form; both return `undefined` here.
 * Anything else gets flagged so the status table highlights it clearly.
 *
 * Note: earlier versions also flagged UUID-shaped values as "looks like a
 * workflow state id" — removed in Gap D because every pushed Linear issue id
 * is a UUID, so that check fired on healthy data.
 */
function staleNoteForIssueId(raw) {
    if (!raw?.trim()) {
        return undefined;
    }
    if (!isLikelyLinearIssueId(raw)) {
        return 'stale-id (value does not look like a Linear issue id; re-run `planr linear push`)';
    }
    return undefined;
}
function cell(s, max = 48) {
    const t = s.trim() || '—';
    return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}
function toStr(v) {
    if (typeof v !== 'string')
        return undefined;
    const t = v.trim();
    return t.length > 0 ? t : undefined;
}
function rowForEpic(openPlanrId, d) {
    const pid = toStr(d.linearProjectId);
    if (!pid) {
        return {
            kind: 'epic',
            openPlanrId,
            linearIdentifier: '(not pushed)',
            linearUrl: '—',
            lastKnownState: '—',
        };
    }
    const strategy = toStr(d.linearMappingStrategy) ?? 'project';
    const url = toStr(d.linearProjectUrl) ?? '—';
    let identifier;
    if (strategy === 'milestone-of') {
        const mid = toStr(d.linearMilestoneId);
        identifier = mid ? `milestone:${mid.slice(0, 8)}` : 'milestone:(pending)';
    }
    else if (strategy === 'label-on') {
        const lid = toStr(d.linearLabelId);
        identifier = lid ? `label:${lid.slice(0, 8)}` : 'label:(pending)';
    }
    else {
        identifier = toStr(d.linearProjectIdentifier) ?? `project:${pid.slice(0, 8)}`;
    }
    return {
        kind: 'epic',
        openPlanrId,
        linearIdentifier: identifier,
        linearUrl: url,
        lastKnownState: '—',
    };
}
/**
 * Generic row builder for issue-shaped artifacts (feature / story / task /
 * quick / backlog). All five have the same frontmatter fields
 * (`linearIssueId`, `linearIssueIdentifier`, `linearIssueUrl`) so a single
 * implementation handles them — only the `kind` label differs.
 */
function rowForIssueArtifact(kind, openPlanrId, d) {
    const issueId = toStr(d.linearIssueId);
    const stale = staleNoteForIssueId(issueId);
    const usable = Boolean(issueId && !stale);
    return {
        kind,
        openPlanrId,
        linearIdentifier: usable
            ? (toStr(d.linearIssueIdentifier) ?? issueId.slice(0, 8))
            : issueId
                ? issueId.slice(0, 8)
                : '(not pushed)',
        linearUrl: usable ? (toStr(d.linearIssueUrl) ?? '—') : '—',
        lastKnownState: String(d.status ?? '—'),
        note: stale,
    };
}
async function pushTaskRow(projectDir, config, rows, taskId) {
    const a = await readArtifact(projectDir, config, 'task', taskId);
    if (!a)
        return;
    rows.push(rowForIssueArtifact('task', taskId, a.data));
}
/**
 * Collect mapping rows from local frontmatter only (no Linear API).
 * With `scopeEpicId`, only that epic and descendants (features, stories, tasks in cascade + tasks with `featureId` in scope).
 */
export async function collectLinearMappingTable(projectDir, config, scopeEpicId) {
    const rows = [];
    if (scopeEpicId) {
        const plan = await buildCascadeOrder(projectDir, config, 'epic', scopeEpicId);
        const featureIdsInScope = new Set(plan.levels[1]?.artifactIds ?? []);
        const storyIdsInScope = new Set(plan.levels[2]?.artifactIds ?? []);
        const taskIdsCascade = new Set(plan.levels[3]?.artifactIds ?? []);
        const ep = await readArtifact(projectDir, config, 'epic', scopeEpicId);
        if (ep) {
            rows.push(rowForEpic(scopeEpicId, ep.data));
        }
        for (const fid of [...featureIdsInScope].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
            const a = await readArtifact(projectDir, config, 'feature', fid);
            if (a) {
                rows.push(rowForIssueArtifact('feature', fid, a.data));
            }
        }
        for (const sid of [...storyIdsInScope].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
            const a = await readArtifact(projectDir, config, 'story', sid);
            if (a) {
                rows.push(rowForIssueArtifact('story', sid, a.data));
            }
        }
        for (const tid of [...taskIdsCascade].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
            await pushTaskRow(projectDir, config, rows, tid);
        }
        const allTasks = await listArtifacts(projectDir, config, 'task');
        for (const t of allTasks.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))) {
            if (taskIdsCascade.has(t.id))
                continue;
            const ta = await readArtifact(projectDir, config, 'task', t.id);
            const feat = ta?.data.featureId;
            if (feat && featureIdsInScope.has(feat)) {
                await pushTaskRow(projectDir, config, rows, t.id);
            }
        }
        // Linked QT / BL artifacts (`epicId` or `parentEpic` pointing at this epic).
        const quicks = await listArtifacts(projectDir, config, 'quick');
        for (const q of quicks.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))) {
            const a = await readArtifact(projectDir, config, 'quick', q.id);
            if (!a)
                continue;
            const linked = toStr(a.data.epicId) ?? toStr(a.data.parentEpic);
            if (linked === scopeEpicId) {
                rows.push(rowForIssueArtifact('quick', q.id, a.data));
            }
        }
        const backlogs = await listArtifacts(projectDir, config, 'backlog');
        for (const b of backlogs.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))) {
            const a = await readArtifact(projectDir, config, 'backlog', b.id);
            if (!a)
                continue;
            const linked = toStr(a.data.epicId) ?? toStr(a.data.parentEpic);
            if (linked === scopeEpicId) {
                rows.push(rowForIssueArtifact('backlog', b.id, a.data));
            }
        }
        return rows;
    }
    const epics = await listArtifacts(projectDir, config, 'epic');
    for (const e of epics.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))) {
        const a = await readArtifact(projectDir, config, 'epic', e.id);
        if (a) {
            rows.push(rowForEpic(e.id, a.data));
        }
    }
    const features = await listArtifacts(projectDir, config, 'feature');
    for (const f of features.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))) {
        const a = await readArtifact(projectDir, config, 'feature', f.id);
        if (a) {
            rows.push(rowForIssueArtifact('feature', f.id, a.data));
        }
    }
    const stories = await listArtifacts(projectDir, config, 'story');
    for (const s of stories.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))) {
        const a = await readArtifact(projectDir, config, 'story', s.id);
        if (a) {
            rows.push(rowForIssueArtifact('story', s.id, a.data));
        }
    }
    const tasks = await listArtifacts(projectDir, config, 'task');
    for (const t of tasks.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))) {
        await pushTaskRow(projectDir, config, rows, t.id);
    }
    const quicks = await listArtifacts(projectDir, config, 'quick');
    for (const q of quicks.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))) {
        const a = await readArtifact(projectDir, config, 'quick', q.id);
        if (a)
            rows.push(rowForIssueArtifact('quick', q.id, a.data));
    }
    const backlogs = await listArtifacts(projectDir, config, 'backlog');
    for (const b of backlogs.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))) {
        const a = await readArtifact(projectDir, config, 'backlog', b.id);
        if (a)
            rows.push(rowForIssueArtifact('backlog', b.id, a.data));
    }
    return rows;
}
export function formatLinearMappingTable(rows) {
    const lines = [];
    const kindW = 7;
    const idW = 14;
    const idenW = 22;
    const stW = 14;
    const noteW = 40;
    // URL goes LAST and is printed in full (no truncation). Clickable URLs are
    // the primary value of this table; truncating them to a fixed width made
    // them useless for copy-paste. Rows with long URLs now trail off freely
    // without disturbing earlier columns.
    lines.push(`${'Kind'.padEnd(kindW)}  ${'OpenPlanr id'.padEnd(idW)}  ${'Linear id'.padEnd(idenW)}  ${'State'.padEnd(stW)}  ${'Note'.padEnd(noteW)}  URL`);
    lines.push(`${'─'.repeat(kindW)}  ${'─'.repeat(idW)}  ${'─'.repeat(idenW)}  ${'─'.repeat(stW)}  ${'─'.repeat(noteW)}  ───`);
    for (const r of rows) {
        const note = r.note ? cell(r.note, noteW) : '';
        lines.push(`${r.kind.padEnd(kindW)}  ${r.openPlanrId.padEnd(idW)}  ${cell(r.linearIdentifier, idenW).padEnd(idenW)}  ${cell(r.lastKnownState, stW).padEnd(stW)}  ${note.padEnd(noteW)}  ${r.linearUrl}`);
    }
    return lines.join('\n');
}
//# sourceMappingURL=linear-mapping-service.js.map