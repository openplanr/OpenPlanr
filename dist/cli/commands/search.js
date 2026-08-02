import chalk from 'chalk';
import { listArtifacts, readArtifactRaw } from '../../services/artifact-service.js';
import { loadConfig } from '../../services/config-service.js';
import { display, logger } from '../../utils/logger.js';
import { parseMarkdown } from '../../utils/markdown.js';
const SEARCHABLE_TYPES = [
    'epic',
    'feature',
    'story',
    'task',
    'quick',
    'backlog',
    'sprint',
    'adr',
];
const TYPE_COLORS = {
    epic: chalk.cyan,
    feature: chalk.white,
    story: chalk.green,
    task: chalk.yellow,
    quick: chalk.magenta,
    backlog: chalk.red,
    sprint: chalk.blueBright,
    adr: chalk.blue,
};
function extractSnippet(content, query) {
    const lines = content.split('\n');
    const queryLower = query.toLowerCase();
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(queryLower)) {
            const start = Math.max(0, i - 1);
            const end = Math.min(lines.length, i + 2);
            const snippetLines = lines.slice(start, end);
            // Highlight the match in each line
            const highlighted = snippetLines.map((line) => {
                const idx = line.toLowerCase().indexOf(queryLower);
                if (idx === -1)
                    return chalk.dim(line);
                return (chalk.dim(line.slice(0, idx)) +
                    chalk.yellow.bold(line.slice(idx, idx + query.length)) +
                    chalk.dim(line.slice(idx + query.length)));
            });
            return highlighted.join('\n');
        }
    }
    return '';
}
async function searchArtifacts(projectDir, config, query, opts) {
    const typesToSearch = opts.type ? [opts.type] : SEARCHABLE_TYPES;
    const queryLower = query.toLowerCase();
    const results = [];
    for (const type of typesToSearch) {
        const artifacts = await listArtifacts(projectDir, config, type);
        for (const artifact of artifacts) {
            const raw = await readArtifactRaw(projectDir, config, type, artifact.id);
            if (!raw)
                continue;
            // Status filter
            if (opts.status) {
                const { data } = parseMarkdown(raw);
                if (data.status && data.status.toLowerCase() !== opts.status.toLowerCase()) {
                    continue;
                }
            }
            // Match against content
            if (!raw.toLowerCase().includes(queryLower))
                continue;
            const snippet = extractSnippet(raw, query);
            results.push({
                id: artifact.id,
                type,
                title: artifact.title,
                snippet,
            });
        }
    }
    return results;
}
export function registerSearchCommand(program) {
    program
        .command('search')
        .description('Search across all planning artifacts')
        .argument('<query>', 'search term or phrase')
        .option('--type <type>', 'filter by artifact type (epic, feature, story, task, quick, adr)')
        .option('--status <status>', 'filter by status (pending, in-progress, done)')
        .action(async (query, opts) => {
        const projectDir = program.opts().projectDir;
        const config = await loadConfig(projectDir);
        // Validate type if provided
        if (opts.type && !SEARCHABLE_TYPES.includes(opts.type)) {
            logger.error(`Invalid type: ${opts.type}`);
            logger.dim(`Valid types: ${SEARCHABLE_TYPES.join(', ')}`);
            process.exit(1);
        }
        const results = await searchArtifacts(projectDir, config, query, opts);
        if (results.length === 0) {
            logger.warn(`No artifacts match "${query}"`);
            return;
        }
        logger.heading(`Search results for "${query}"`);
        display.blank();
        // Group results by type
        const grouped = new Map();
        for (const r of results) {
            const existing = grouped.get(r.type) || [];
            existing.push(r);
            grouped.set(r.type, existing);
        }
        for (const [type, items] of grouped) {
            const colorFn = TYPE_COLORS[type] || chalk.white;
            display.line(colorFn(`  ${type.toUpperCase()} (${items.length})`));
            for (const item of items) {
                display.line(`    ${chalk.bold(item.id)}  ${item.title}`);
                if (item.snippet) {
                    for (const line of item.snippet.split('\n')) {
                        display.line(`      ${line}`);
                    }
                }
                display.blank();
            }
        }
        const typeCount = grouped.size;
        logger.dim(`Found ${results.length} result${results.length !== 1 ? 's' : ''} across ${typeCount} artifact type${typeCount !== 1 ? 's' : ''}`);
    });
}
//# sourceMappingURL=search.js.map