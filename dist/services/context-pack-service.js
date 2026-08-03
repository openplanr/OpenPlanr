/**
 * Assemble stakeholder report context from `.planr/` artifacts and optional GitHub signals.
 */
import { listArtifacts, readArtifact } from './artifact-service.js';
import { fetchRecentCommits, fetchRecentPullRequests } from './github-service.js';
function statusOf(data) {
    const s = data.status ?? data.Status;
    return typeof s === 'string' ? s : 'unknown';
}
function titleOf(meta, data) {
    const t = data.title;
    if (typeof t === 'string' && t.trim())
        return t;
    return meta.title;
}
export async function buildStakeholderReportContext(projectDir, config, opts) {
    const generatedAt = new Date().toISOString();
    const epicsMeta = await listArtifacts(projectDir, config, 'epic');
    const featuresMeta = await listArtifacts(projectDir, config, 'feature');
    const storiesMeta = await listArtifacts(projectDir, config, 'story');
    const tasksMeta = await listArtifacts(projectDir, config, 'task');
    const epics = [];
    for (const m of epicsMeta) {
        const a = await readArtifact(projectDir, config, 'epic', m.id);
        const data = (a?.data ?? {});
        epics.push({
            id: m.id,
            title: titleOf(m, data),
            status: statusOf(data),
            type: 'epic',
        });
    }
    const features = [];
    for (const m of featuresMeta) {
        const a = await readArtifact(projectDir, config, 'feature', m.id);
        const data = (a?.data ?? {});
        features.push({
            id: m.id,
            title: titleOf(m, data),
            status: statusOf(data),
            type: 'feature',
        });
    }
    const stories = [];
    for (const m of storiesMeta) {
        const a = await readArtifact(projectDir, config, 'story', m.id);
        const data = (a?.data ?? {});
        stories.push({
            id: m.id,
            title: titleOf(m, data),
            status: statusOf(data),
            type: 'story',
        });
    }
    const tasks = [];
    for (const m of tasksMeta) {
        const a = await readArtifact(projectDir, config, 'task', m.id);
        const data = (a?.data ?? {});
        tasks.push({
            id: m.id,
            title: titleOf(m, data),
            status: statusOf(data),
            type: 'task',
        });
    }
    let sprint;
    if (opts.sprintId) {
        const s = await readArtifact(projectDir, config, 'sprint', opts.sprintId);
        if (s) {
            const data = s.data;
            const rawGoals = data.goals;
            const goals = Array.isArray(rawGoals) ? rawGoals.map(String) : [];
            const rawTaskIds = data.taskIds;
            const taskIds = Array.isArray(rawTaskIds) ? rawTaskIds.map(String) : [];
            sprint = {
                sprintId: opts.sprintId,
                name: String(data.name ?? opts.sprintId),
                status: statusOf(data),
                startDate: String(data.startDate ?? ''),
                endDate: String(data.endDate ?? ''),
                goals,
                taskIds,
            };
        }
    }
    let github;
    let noGitHub = !opts.includeGitHub;
    if (opts.includeGitHub) {
        const [cRes, pRes] = await Promise.all([
            fetchRecentCommits({ days: opts.days, limit: 30 }),
            fetchRecentPullRequests({ days: opts.days, limit: 20 }),
        ]);
        const warn = [cRes.warning, pRes.warning].filter(Boolean).join(' ');
        github = {
            commits: cRes.commits,
            pullRequests: pRes.pullRequests,
            warning: warn || undefined,
            fetchedAt: generatedAt,
        };
        noGitHub = Boolean(warn) && cRes.commits.length === 0 && pRes.pullRequests.length === 0;
    }
    const doneStories = stories.filter((x) => /done|closed/i.test(x.status));
    const anchorStories = doneStories.length > 0 ? doneStories.slice(0, 15) : stories.slice(0, 15);
    const evidence = buildEvidenceList(github, anchorStories);
    const branding = config.reports;
    return {
        projectName: config.projectName,
        generatedAt,
        reportType: opts.reportType,
        daysLookback: opts.days,
        sprint,
        artifacts: { epics, features, stories, tasks },
        github,
        branding,
        placeholders: {
            noSprint: !sprint,
            noGitHub: noGitHub,
            noStoriesCompleted: doneStories.length === 0,
        },
        evidence,
    };
}
function buildEvidenceList(github, stories) {
    const out = [];
    for (const s of stories) {
        out.push({
            id: `artifact-${s.id}`,
            kind: 'artifact',
            label: `${s.id}: ${s.title}`,
            detail: `Status: ${s.status}`,
        });
    }
    if (github) {
        for (const c of github.commits.slice(0, 20)) {
            out.push({
                id: `commit-${c.shortSha}`,
                kind: 'commit',
                label: c.message,
                url: c.url,
                detail: `${c.authorLogin} · ${c.committedDate}`,
            });
        }
        for (const p of github.pullRequests.slice(0, 15)) {
            out.push({
                id: `pr-${p.number}`,
                kind: 'pull_request',
                label: `PR #${p.number}: ${p.title}`,
                url: p.url,
                detail: `${p.state} · ${p.authorLogin}`,
            });
        }
    }
    return out;
}
//# sourceMappingURL=context-pack-service.js.map