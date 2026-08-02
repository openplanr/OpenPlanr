/**
 * Delivery-status aggregation — the deterministic core behind `planr status`
 * (no slug → whole-project delivery report). Rolls up every Spec / Backlog /
 * Quick Task (or the agile tree) by status and OPTIONALLY cross-references
 * GitHub PRs and Linear issue state.
 *
 * Reuses existing services (no new auth, no new sources):
 *   listSpecs            (spec-service)        — spec rows + status + counts
 *   listArtifacts/readArtifact/readArtifactRaw (artifact-service) — frontmatter
 *   fetchRecentPullRequests/getIssue           (github-service)   — PR/issue state (gh CLI)
 *   createLinearClient/fetchLinearIssueStateNames (linear-service) — live issue state
 *
 * Pure aggregation + a typed result so the command layer can render it as
 * terminal / markdown / json without re-querying.
 */
import { parseTaskMarkdown } from '../agents/task-parser.js';
import { logger } from '../utils/logger.js';
import { listArtifacts, readArtifact, readArtifactRaw } from './artifact-service.js';
import { listSpecs } from './spec-service.js';
/** Per-type "done" semantics for a delivery roll-up. */
function isDone(type, status) {
    const s = (status || '').toLowerCase();
    if (type === 'backlog')
        return s === 'closed' || s === 'done';
    return s === 'done' || s === 'completed' || s === 'shipped' || s === 'released';
}
/**
 * "Addressed" = resolved without being done: a backlog item `promoted` into a
 * spec/QT/story, or any artifact `superseded` (split/replaced). These are not
 * outstanding work — but counting them as "done" misstates the delivery
 * summary (e.g. "1 done + 6 promoted", not "7 done").
 */
function isAddressed(status) {
    const s = (status || '').toLowerCase();
    return s === 'promoted' || s === 'superseded';
}
function pickStr(v) {
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}
/** Read an artifact's frontmatter + (for checklists) its subtask completion. */
async function toItem(projectDir, config, type, meta) {
    const artType = type;
    const read = await readArtifact(projectDir, config, artType, meta.id);
    const fm = (read?.data ?? {});
    const status = pickStr(fm.status) ?? 'pending';
    let progress;
    if (type === 'quick' || type === 'task') {
        const raw = await readArtifactRaw(projectDir, config, artType, meta.id);
        if (raw) {
            const parsed = parseTaskMarkdown(raw);
            const subtasks = parsed.filter((s) => s.depth > 0);
            const list = subtasks.length > 0 ? subtasks : parsed;
            const total = list.length;
            if (total > 0)
                progress = { done: list.filter((s) => s.done).length, total };
        }
    }
    const linearId = pickStr(fm.linearIssueIdentifier);
    const item = {
        id: meta.id,
        title: pickStr(fm.title) ?? meta.title,
        type,
        status,
        done: isDone(type, status),
        addressed: isAddressed(status),
        progress,
        priority: pickStr(fm.priority),
    };
    if (linearId) {
        item.linear = {
            identifier: linearId,
            url: pickStr(fm.linearIssueUrl),
            state: pickStr(fm.linearStatusReconciled),
        };
        // stash the UUID for the optional --linear live pass
        item._linearId = pickStr(fm.linearIssueId);
    }
    const ghIssue = typeof fm.githubIssue === 'number' ? fm.githubIssue : undefined;
    if (ghIssue)
        item.github = { issue: ghIssue };
    return item;
}
/** Collect the full delivery status (optionally scoped, optionally live-enriched). */
export async function collectDeliveryStatus(projectDir, config, opts = {}) {
    const warnings = [];
    const specs = config.idPrefix?.spec ? await listSpecs(projectDir, config) : [];
    const mode = specs.length > 0 ? 'spec-driven' : 'agile';
    const groups = {};
    const order = [];
    const add = (label, items) => {
        if (items.length === 0)
            return;
        groups[label] = items;
        order.push(label);
    };
    if (mode === 'spec-driven') {
        add('Specs', specs.map((s) => ({
            id: s.id,
            title: s.title,
            type: 'spec',
            status: s.status,
            done: isDone('spec', s.status),
            addressed: isAddressed(s.status),
            // spec rows report status only — we don't roll up per-spec task completion here
            // (would read every spec's task files); `done` status is the delivery signal.
        })));
    }
    else {
        for (const t of ['epic', 'feature', 'story', 'task']) {
            const list = await listArtifacts(projectDir, config, t);
            const items = await Promise.all(list.map((m) => toItem(projectDir, config, t, m)));
            add(t === 'epic' ? 'Epics' : t === 'feature' ? 'Features' : t === 'story' ? 'Stories' : 'Tasks', items);
        }
    }
    const backlog = await listArtifacts(projectDir, config, 'backlog');
    add('Backlog', await Promise.all(backlog.map((m) => toItem(projectDir, config, 'backlog', m))));
    const quick = await listArtifacts(projectDir, config, 'quick');
    add('Quick Tasks', await Promise.all(quick.map((m) => toItem(projectDir, config, 'quick', m))));
    // Optional scoping to one id/slug (matches the item or its id prefix).
    if (opts.scope) {
        const scope = opts.scope.trim().toLowerCase();
        for (const label of order) {
            groups[label] = groups[label].filter((i) => {
                const id = i.id.toLowerCase();
                return id === scope || id.startsWith(scope) || i.title.toLowerCase().includes(scope);
            });
        }
    }
    const allItems = order.flatMap((l) => groups[l]);
    if (opts.linear)
        await enrichLinear(allItems, warnings);
    if (opts.github)
        await enrichGithub(allItems, warnings);
    const summary = order.map((label) => ({
        label,
        done: groups[label].filter((i) => i.done).length,
        addressed: groups[label].filter((i) => i.addressed).length,
        total: groups[label].length,
    }));
    const outstanding = allItems.filter((i) => !i.done && !i.addressed);
    return { projectName: config.projectName, mode, groups, order, summary, outstanding, warnings };
}
/** --linear: resolve live issue state for items carrying a Linear UUID. */
async function enrichLinear(items, warnings) {
    const withId = items.filter((i) => i._linearId);
    if (withId.length === 0)
        return;
    try {
        const { createLinearClient, fetchLinearIssueStateNames, LINEAR_CREDENTIAL_KEY } = await import('./linear-service.js');
        const { resolveApiKey } = await import('./credentials-service.js');
        const token = (await resolveApiKey(LINEAR_CREDENTIAL_KEY))?.trim();
        if (!token) {
            warnings.push('--linear: no Linear token (run `planr linear init` or set PLANR_LINEAR_TOKEN); using reconciled state.');
            return;
        }
        const client = createLinearClient(token);
        const ids = withId.map((i) => i._linearId);
        const states = await fetchLinearIssueStateNames(client, ids);
        for (const i of withId) {
            const uuid = i._linearId;
            const state = states.get(uuid);
            if (state && i.linear)
                i.linear.state = state;
        }
    }
    catch (err) {
        logger.debug('enrichLinear failed', err);
        warnings.push('--linear: could not reach Linear; using reconciled state from frontmatter.');
    }
}
/** --github: resolve issue state + best-effort PR correlation (artifact id in PR title/branch). */
async function enrichGithub(items, warnings) {
    try {
        const { verifyGitHubRepo, getIssue, fetchRecentPullRequests } = await import('./github-service.js');
        await verifyGitHubRepo();
        // Best-effort PR correlation: a wide PR window, matched by artifact id in title/branch.
        const { pullRequests, warning } = await fetchRecentPullRequests({ days: 3650, limit: 300 });
        if (warning)
            warnings.push(`--github: ${warning}`);
        for (const i of items) {
            const idRe = new RegExp(`\\b${i.id}\\b`, 'i');
            const pr = pullRequests.find((p) => idRe.test(p.title));
            if (pr)
                i.github = { ...(i.github ?? {}), pr: { number: pr.number, merged: pr.mergedAt != null } };
        }
        // Resolve linked-issue state where an artifact stored a githubIssue number.
        for (const i of items) {
            if (!i.github?.issue)
                continue;
            try {
                const issue = await getIssue(i.github.issue);
                i.github.issueState = issue.state;
            }
            catch {
                /* issue gone / no access — skip */
            }
        }
    }
    catch (err) {
        logger.debug('enrichGithub failed', err);
        warnings.push('--github: could not reach GitHub (is `gh` authenticated?); showing frontmatter links only.');
    }
}
//# sourceMappingURL=delivery-status-service.js.map