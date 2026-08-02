/**
 * Bidirectional task checkbox sync between Linear TaskList issue descriptions and local `.md` files (FEAT-018).
 */
import { parseTaskMarkdown } from '../agents/task-parser.js';
import { logger } from '../utils/logger.js';
import { applyTaskCheckboxStateMap, parseTaskCheckboxLines, parseTaskCheckboxReconciled, serializeTaskCheckboxReconciled, } from '../utils/markdown.js';
import { listArtifacts, readArtifact, readArtifactRaw, updateArtifact, updateArtifactFields, } from './artifact-service.js';
import { isNonInteractive } from './interactive-state.js';
import { formatTaskCheckboxBody } from './linear-push-service.js';
import { getLinearIssueDescription, isLikelyLinearWorkflowStateId, updateLinearIssue, } from './linear-service.js';
import { promptSelect } from './prompt-service.js';
function toDoneMap(parsed) {
    return new Map(parsed.map((t) => [t.id, t.done]));
}
/**
 * Rebuild a `ParsedSubtask` list in document order: local file order, then any ids only in remote, then apply `final` done flags.
 */
export function mergeByIdForFormat(local, remote, final) {
    const fromLocal = new Map(local.map((t) => [t.id, t]));
    const out = [];
    const used = new Set();
    for (const t of local) {
        if (!final.has(t.id) || used.has(t.id))
            continue;
        const d = final.get(t.id);
        if (d === undefined)
            continue;
        out.push({ ...t, done: d });
        used.add(t.id);
    }
    for (const t of remote) {
        if (used.has(t.id) || !final.has(t.id))
            continue;
        const d = final.get(t.id);
        if (d === undefined)
            continue;
        out.push({ ...(fromLocal.get(t.id) ?? t), done: d });
        used.add(t.id);
    }
    return out;
}
/** Merged issue body: return text for an artifact’s section, or the whole body when a single file owns the issue. */
export function extractTaskSectionFromMergedDescription(merged, taskFileId, siblingFileCount) {
    const token = `## ${taskFileId}`;
    if (siblingFileCount === 1) {
        if (!merged.includes('## ')) {
            return merged.trim();
        }
        if (merged.includes(token)) {
            return extractBlockAfterH2(merged, taskFileId);
        }
        return merged.trim();
    }
    if (merged.includes(token)) {
        return extractBlockAfterH2(merged, taskFileId);
    }
    if (merged.includes('## ')) {
        return '';
    }
    return merged.trim();
}
function extractBlockAfterH2(merged, taskFileId) {
    const token = `## ${taskFileId}`;
    const idx = merged.indexOf(token);
    if (idx === -1) {
        return merged.trim();
    }
    const after = merged.slice(idx + token.length).replace(/^\n+/, '');
    const nextH2 = after.search(/^## /m);
    return (nextH2 === -1 ? after : after.slice(0, nextH2)).trim();
}
export function replaceTaskSectionInMergedDescription(merged, taskFileId, newSectionBody) {
    if (!merged.includes('## ')) {
        return newSectionBody.trim();
    }
    const token = `## ${taskFileId}`;
    const idx = merged.indexOf(token);
    if (idx === -1) {
        return newSectionBody.trim();
    }
    const before = merged.slice(0, idx);
    const afterHeader = merged.slice(idx + token.length);
    const nextH2 = afterHeader.search(/^## /m);
    const tail = nextH2 === -1 ? '' : afterHeader.slice(nextH2);
    return `${before}${token}\n\n${newSectionBody.trim()}\n\n${tail}`.replace(/\n\n\n+/g, '\n\n');
}
/**
 * Three-way merge for checkbox `id -> done` and presence. A key is **absent** in a version when the task line is not in that side’s parse.
 * Exported for unit tests.
 */
export async function resolveTaskCheckboxFinalStates(local, remote, base, strategy, label) {
    const ids = new Set([...local.keys(), ...remote.keys(), ...base.keys()]);
    const final = new Map();
    let conflictDecisions = 0;
    for (const id of ids) {
        const lh = local.has(id);
        const rh = remote.has(id);
        const bh = base.has(id);
        const l = lh ? local.get(id) : undefined;
        const r = rh ? remote.get(id) : undefined;
        const b = bh ? base.get(id) : undefined;
        if (lh && rh && l === r) {
            if (l !== undefined) {
                final.set(id, l);
            }
            continue;
        }
        if (!lh && !rh) {
            continue;
        }
        if (b === l && l !== r) {
            if (r !== undefined) {
                final.set(id, r);
            }
            continue;
        }
        if (b === r && l !== r) {
            if (l !== undefined) {
                final.set(id, l);
            }
            continue;
        }
        if (bh && lh && !rh && l !== b && l !== undefined) {
            final.set(id, l);
            continue;
        }
        if (bh && rh && !lh && r !== b && r !== undefined) {
            final.set(id, r);
            continue;
        }
        if (!bh && l !== undefined && r === undefined) {
            final.set(id, l);
            continue;
        }
        if (!bh && r !== undefined && l === undefined) {
            final.set(id, r);
            continue;
        }
        const choice = await pickConflict(strategy, { id, base: b, local: l, remote: r }, label);
        if (l !== undefined && r !== undefined) {
            final.set(id, choice === 'local' ? l : r);
        }
        else if (l !== undefined) {
            final.set(id, l);
        }
        else if (r !== undefined) {
            final.set(id, r);
        }
        conflictDecisions++;
    }
    return { final, conflictDecisions };
}
async function pickConflict(strategy, c, label) {
    if (strategy === 'local') {
        if (c.local === undefined)
            return 'linear';
        return 'local';
    }
    if (strategy === 'linear') {
        if (c.remote === undefined)
            return 'local';
        return 'linear';
    }
    if (isNonInteractive()) {
        logger.dim(`  [auto] ${label} task ${c.id} conflict: using Linear (set --on-conflict local|linear)`);
        return c.remote !== undefined ? 'linear' : 'local';
    }
    const def = c.remote !== undefined ? 'linear' : 'local';
    return promptSelect(`${label}: checkbox conflict on ${c.id} (base=${String(c.base)} local=${String(c.local)} remote=${String(c.remote)}). Use which side?`, [
        { name: 'Local file', value: 'local' },
        { name: 'Linear', value: 'linear' },
    ], def);
}
const TASK_CHECKBOX = /^(\s*)- \[(x| )]\s+\*{0,2}(\d+\.\d+)\*{0,2}\s+(.+)$/;
/** Drop checkbox lines for ids that should be absent, apply done states, append new lines for ids in `rebuilt` that are still missing. */
export function applyCheckboxMergeToLocalBody(body, final, rebuilt) {
    const lines = [];
    for (const line of body.split('\n')) {
        const m = line.match(TASK_CHECKBOX);
        if (m) {
            const id = m[3];
            if (!final.has(id)) {
                continue;
            }
        }
        lines.push(line);
    }
    let out = lines.join('\n');
    out = applyTaskCheckboxStateMap(out, final);
    const present = new Set(parseTaskCheckboxLines(out).map((t) => t.id));
    const toAdd = rebuilt.filter((t) => final.has(t.id) && !present.has(t.id));
    if (toAdd.length === 0) {
        return out;
    }
    const block = formatTaskCheckboxBody(toAdd);
    if (!block) {
        return out;
    }
    const trimmed = out.trimEnd();
    return `${trimmed ? `${trimmed}\n\n` : ''}${block}\n`;
}
/**
 * For each `task` artifact with `linearIssueId`, load the shared Linear description (once per issue id),
 * reconcile checkboxes with the local file using three-way merge, then write back local and/or Linear.
 */
export async function runLinearTaskCheckboxSync(projectDir, config, client, opts = {}) {
    const onConflict = opts.onConflict ?? 'prompt';
    const dryRun = opts.dryRun === true;
    const summary = {
        filesProcessed: 0,
        filesUpdatedLocal: 0,
        linearIssuesUpdated: 0,
        conflictDecisions: 0,
        skippedNoIssue: 0,
    };
    const allTasks = await listArtifacts(projectDir, config, 'task');
    const byIssue = new Map();
    for (const t of allTasks) {
        const a = await readArtifact(projectDir, config, 'task', t.id);
        const issueId = a?.data.linearIssueId;
        if (!issueId) {
            continue;
        }
        if (isLikelyLinearWorkflowStateId(issueId)) {
            continue;
        }
        if (!byIssue.has(issueId)) {
            byIssue.set(issueId, []);
        }
        const group = byIssue.get(issueId);
        if (group) {
            group.push(t.id);
        }
    }
    for (const [issueId, taskIds] of byIssue) {
        let merged = await getLinearIssueDescription(client, issueId);
        const sortedFiles = [...taskIds].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        const siblingFileCount = sortedFiles.length;
        let issueDirty = false;
        for (const taskFileId of sortedFiles) {
            summary.filesProcessed++;
            const raw = await readArtifactRaw(projectDir, config, 'task', taskFileId);
            if (!raw) {
                continue;
            }
            const data = (await readArtifact(projectDir, config, 'task', taskFileId))?.data;
            const li = data?.linearIssueId ?? issueId;
            if (!li) {
                summary.skippedNoIssue++;
                continue;
            }
            const open = raw.indexOf('---');
            const close = raw.indexOf('\n---', open + 3);
            if (open === -1 || close === -1) {
                continue;
            }
            const body = raw.slice(close + 4);
            const localParsed = parseTaskMarkdown(body);
            const localMap = toDoneMap(localParsed);
            const section = extractTaskSectionFromMergedDescription(merged, taskFileId, siblingFileCount);
            const remoteParsed = parseTaskMarkdown(section);
            const remoteMap = toDoneMap(remoteParsed);
            const baseStr = data?.linearChecklistReconciled ?? undefined;
            const baseMap = parseTaskCheckboxReconciled(baseStr);
            const { final, conflictDecisions: cd } = await resolveTaskCheckboxFinalStates(localMap, remoteMap, baseMap, onConflict, taskFileId);
            summary.conflictDecisions += cd;
            const rebuilt = mergeByIdForFormat(localParsed, remoteParsed, final);
            const newSection = formatTaskCheckboxBody(rebuilt);
            const newBody = applyCheckboxMergeToLocalBody(body, final, rebuilt);
            const merged2 = replaceTaskSectionInMergedDescription(merged, taskFileId, newSection);
            if (merged2 !== merged) {
                merged = merged2;
                issueDirty = true;
            }
            if (newBody !== body) {
                if (!dryRun) {
                    const newRaw = raw.slice(0, close + 4) + newBody;
                    await updateArtifact(projectDir, config, 'task', taskFileId, newRaw);
                }
                summary.filesUpdatedLocal++;
            }
            const newRecon = serializeTaskCheckboxReconciled(final);
            if (newRecon !== (baseStr ?? '')) {
                if (!dryRun) {
                    await updateArtifactFields(projectDir, config, 'task', taskFileId, {
                        linearChecklistReconciled: newRecon,
                        linearTaskChecklistSyncedAt: new Date().toISOString(),
                    });
                }
            }
        }
        if (issueDirty) {
            if (!dryRun) {
                await updateLinearIssue(client, issueId, { description: merged });
            }
            summary.linearIssuesUpdated++;
        }
    }
    return summary;
}
//# sourceMappingURL=linear-sync-service.js.map