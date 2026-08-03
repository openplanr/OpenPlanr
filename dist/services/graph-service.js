import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseMarkdown } from '../utils/markdown.js';
const AGILE_DIRS = ['epics', 'features', 'stories', 'tasks', 'backlog', 'quick', 'sprints', 'adrs'];
const PARENT_FIELDS = ['epicId', 'featureId', 'storyId', 'specId'];
const DONE_STATES = new Set(['done', 'closed', 'completed', 'shipped', 'released']);
const ADDRESSED_STATES = new Set(['promoted', 'superseded']);
const ID_PREFIX_TYPE = {
    EPIC: 'epic',
    FEAT: 'feature',
    US: 'story',
    T: 'task',
    TASK: 'task',
    SPEC: 'spec',
    ADR: 'adr',
};
function isArtifactFile(name) {
    if (name.startsWith('.'))
        return false;
    if (name.endsWith('-error-report.md'))
        return false;
    if (name.endsWith('-gherkin.feature'))
        return false;
    return name.endsWith('.md');
}
function walkAgileDir(dir, acc) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return acc;
    }
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!entry.name.startsWith('.'))
                walkAgileDir(fullPath, acc);
        }
        else if (entry.isFile() && isArtifactFile(entry.name)) {
            acc.push(fullPath);
        }
    }
    return acc;
}
function collectSpecDir(specDir, acc) {
    let entries;
    try {
        entries = readdirSync(specDir, { withFileTypes: true });
    }
    catch {
        return acc;
    }
    for (const entry of entries) {
        const fullPath = path.join(specDir, entry.name);
        if (entry.isFile()) {
            if (/^SPEC-\d+.*\.md$/.test(entry.name))
                acc.push(fullPath);
        }
        else if (entry.isDirectory() && (entry.name === 'stories' || entry.name === 'tasks')) {
            const prefix = entry.name === 'stories' ? 'US-' : 'T-';
            let inner;
            try {
                inner = readdirSync(fullPath, { withFileTypes: true });
            }
            catch {
                continue;
            }
            for (const file of inner) {
                if (file.isFile() && file.name.startsWith(prefix) && isArtifactFile(file.name)) {
                    acc.push(path.join(fullPath, file.name));
                }
            }
        }
    }
    return acc;
}
function collectArtifacts(planrDir) {
    const acc = [];
    for (const dir of AGILE_DIRS) {
        walkAgileDir(path.join(planrDir, dir), acc);
    }
    const specsRoot = path.join(planrDir, 'specs');
    let specEntries = [];
    try {
        specEntries = readdirSync(specsRoot, { withFileTypes: true });
    }
    catch {
        specEntries = [];
    }
    for (const entry of specEntries) {
        if (entry.isDirectory() && /^SPEC-\d+/.test(entry.name)) {
            collectSpecDir(path.join(specsRoot, entry.name), acc);
        }
    }
    return acc;
}
function inferType(relativeDir, id) {
    const segments = relativeDir.split('/').filter(Boolean);
    const top = segments[0] || '';
    switch (top) {
        case 'epics':
            return 'epic';
        case 'features':
            return 'feature';
        case 'stories':
            return 'story';
        case 'tasks':
            return 'task';
        case 'backlog':
            return 'backlog';
        case 'quick':
            return 'quick';
        case 'sprints':
            return 'sprint';
        case 'adrs':
            return 'adr';
        case 'specs':
            if (segments.includes('stories'))
                return 'story';
            if (segments.includes('tasks'))
                return 'task';
            return 'spec';
        default:
            break;
    }
    const prefix = (id || '').split('-')[0].toUpperCase();
    return ID_PREFIX_TYPE[prefix] ?? 'spec';
}
function specScopeOf(relativeDir) {
    const segments = relativeDir.split('/').filter(Boolean);
    if (segments[0] !== 'specs')
        return null;
    const match = /^(SPEC-\d+)/.exec(segments[1] || '');
    return match ? match[1] : null;
}
export function classifyGraphStatus(rawStatus) {
    const status = String(rawStatus ?? '')
        .trim()
        .toLowerCase();
    if (status === 'blocked')
        return 'blocked';
    if (status === 'in-progress' || status === 'in_progress' || status === 'in progress') {
        return 'in-progress';
    }
    if (DONE_STATES.has(status))
        return 'done';
    if (ADDRESSED_STATES.has(status))
        return 'addressed';
    return 'outstanding';
}
function buildNode(absPath, planrDir, includeBody) {
    let raw;
    try {
        raw = readFileSync(absPath, 'utf-8');
    }
    catch {
        return null;
    }
    const parsed = parseMarkdown(raw);
    const frontmatter = { ...(parsed.data || {}) };
    const relativeDir = path
        .relative(planrDir, path.dirname(absPath))
        .split(path.sep)
        .join('/')
        .replace(/^\//, '');
    const localId = frontmatter.id != null && String(frontmatter.id).trim() !== ''
        ? String(frontmatter.id)
        : path.basename(absPath, '.md');
    const type = inferType(relativeDir, localId);
    const scope = specScopeOf(relativeDir);
    const id = scope && type !== 'spec' ? `${scope}/${localId}` : localId;
    const title = frontmatter.title != null && String(frontmatter.title).trim() !== ''
        ? String(frontmatter.title)
        : localId;
    frontmatter.id = localId;
    if (scope)
        frontmatter.specScope = scope;
    const node = {
        id,
        type,
        title,
        status: classifyGraphStatus(frontmatter.status),
        frontmatter,
    };
    if (frontmatter.githubIssue !== undefined && frontmatter.githubIssue !== '') {
        node.githubIssue = frontmatter.githubIssue;
    }
    if (frontmatter.linearIssueIdentifier !== undefined && frontmatter.linearIssueIdentifier !== '') {
        node.linearIssueIdentifier = String(frontmatter.linearIssueIdentifier);
    }
    if (includeBody)
        node.body = parsed.content;
    return node;
}
function resolveRef(rawRef, scope, field) {
    const ref = String(rawRef);
    if (!scope)
        return ref;
    if (field === 'specId' || /^SPEC-\d+/.test(ref))
        return ref;
    return `${scope}/${ref}`;
}
export function readGraph(planrDir, opts = {}) {
    if (!planrDir || !existsSync(planrDir))
        return { nodes: [], edges: [] };
    let stat;
    try {
        stat = statSync(planrDir);
    }
    catch {
        return { nodes: [], edges: [] };
    }
    if (!stat.isDirectory())
        return { nodes: [], edges: [] };
    const nodes = [];
    const idSet = new Set();
    for (const file of collectArtifacts(planrDir)) {
        const node = buildNode(file, planrDir, opts.includeBody === true);
        if (!node?.id || idSet.has(node.id))
            continue;
        nodes.push(node);
        idSet.add(node.id);
    }
    const edges = [];
    const edgeSet = new Set();
    const addEdge = (from, to, kind) => {
        if (!from || !to)
            return;
        const key = `${kind}\0${from}\0${to}`;
        if (edgeSet.has(key))
            return;
        edgeSet.add(key);
        edges.push({ from, to, kind });
    };
    for (const node of nodes) {
        const scope = typeof node.frontmatter.specScope === 'string' ? node.frontmatter.specScope : null;
        for (const field of PARENT_FIELDS) {
            const parent = node.frontmatter[field];
            if (parent == null || parent === '')
                continue;
            const parentId = resolveRef(parent, scope, field);
            if (idSet.has(parentId))
                addEdge(parentId, node.id, 'contains');
        }
        const dependsOn = node.frontmatter.dependsOn;
        if (Array.isArray(dependsOn)) {
            for (const dep of dependsOn) {
                if (dep == null || dep === '')
                    continue;
                const depId = resolveRef(dep, scope, 'dependsOn');
                if (idSet.has(depId))
                    addEdge(node.id, depId, 'depends_on');
            }
        }
    }
    return { nodes, edges };
}
export function readProjectGraph(projectDir, config, opts = {}) {
    return readGraph(path.join(projectDir, config.outputPaths.agile), opts);
}
//# sourceMappingURL=graph-service.js.map