import YAML from 'yaml';
const FRONTMATTER_REGEX = /^---[^\S\r\n]*\r?\n([\s\S]*?)\r?\n---[^\S\r\n]*\r?\n?([\s\S]*)$/;
export function parseMarkdown(raw) {
    const match = FRONTMATTER_REGEX.exec(raw);
    if (!match) {
        return { data: {}, content: raw };
    }
    const yamlStr = match[1];
    const content = match[2];
    const data = YAML.parse(yamlStr) ?? {};
    return { data: data, content };
}
export function toMarkdownWithFrontmatter(data, content) {
    const yamlStr = YAML.stringify(data).trimEnd();
    return `---\n${yamlStr}\n---\n${content}`;
}
/**
 * Parse OpenPlanr task list checkbox lines (same format as `parseTaskMarkdown` in `task-parser.ts`).
 * Exposes 0-based `lineIndex` (the array index into `content.split('\n')`).
 */
export function parseTaskCheckboxLines(content) {
    const lines = content.split('\n');
    const tasks = [];
    let currentGroupId = null;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        if (line === undefined) {
            continue;
        }
        const match = line.match(/^(\s*)- \[(x| )]\s+\*{0,2}(\d+\.\d+)\*{0,2}\s+(.+)$/);
        if (!match)
            continue;
        const indent = match[1].length;
        const done = match[2] === 'x';
        const id = match[3];
        const title = match[4].trim();
        const depth = indent > 0 ? 1 : 0;
        if (depth === 0) {
            currentGroupId = id;
        }
        tasks.push({
            id,
            title,
            done,
            parentId: depth === 0 ? null : currentGroupId,
            depth,
            lineIndex,
            lineText: line,
        });
    }
    return tasks;
}
const RECONCILED_PART = /^\d+\.\d+:[01]$/;
/** Serialize a reconciled id→done map: `1.0:1,1.1:0,2.0:1` (ids sorted with numeric sort). */
export function serializeTaskCheckboxReconciled(m) {
    const entries = m instanceof Map ? [...m.entries()] : Object.entries(m);
    return entries
        .filter(([k, v]) => typeof v === 'boolean' && k.includes('.'))
        .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
        .map(([k, v]) => `${k}:${v ? 1 : 0}`)
        .join(',');
}
export function parseTaskCheckboxReconciled(s) {
    const m = new Map();
    if (!s?.trim())
        return m;
    for (const part of s.split(/[,;]/)) {
        const p = part.trim();
        if (!p || !RECONCILED_PART.test(p))
            continue;
        const [id, b] = p.split(':');
        m.set(id, b === '1');
    }
    return m;
}
/**
 * Apply new done states to matching `N.M` task lines; preserves non-matching lines and all other text.
 */
export function applyTaskCheckboxStateMap(content, idToDone) {
    if (idToDone.size === 0)
        return content;
    return content
        .split('\n')
        .map((line) => {
        const m2 = line.match(/^(\s*)- \[(x| )]\s+\*{0,2}(\d+\.\d+)\*{0,2}\s+(.+)$/);
        if (!m2)
            return line;
        const id = m2[3];
        if (!idToDone.has(id))
            return line;
        const want = idToDone.get(id) ? 'x' : ' ';
        return line.replace(/- \[(x| )]/, `- [${want}]`);
    })
        .join('\n');
}
/**
 * Flip every `N.M` task checkbox in `content` to a single state. Preserves
 * line structure, indentation, ids, titles, and every non-checkbox line.
 *
 * Used by `--all-done` / `--all-pending` flags on artifact updates so users
 * can ship an artifact without hand-flipping each subtask.
 */
export function applyAllCheckboxes(content, done) {
    const want = done ? 'x' : ' ';
    return content
        .split('\n')
        .map((line) => {
        // Match the same shape as applyTaskCheckboxStateMap so we touch only
        // the canonical N.M task lines and never accidentally edit prose,
        // links, or backticked checkbox-like text.
        const m = line.match(/^(\s*)- \[(x| )]\s+\*{0,2}(\d+\.\d+)\*{0,2}\s+(.+)$/);
        if (!m)
            return line;
        return line.replace(/- \[(x| )]/, `- [${want}]`);
    })
        .join('\n');
}
//# sourceMappingURL=markdown.js.map