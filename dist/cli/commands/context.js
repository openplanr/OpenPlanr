/**
 * `planr context` — emit stakeholder report context as JSON (for scripting / pipes).
 */
import { loadConfig } from '../../services/config-service.js';
import { buildStakeholderReportContext } from '../../services/context-pack-service.js';
import { logger } from '../../utils/logger.js';
function parseReportType(raw) {
    const s = raw.toLowerCase().trim();
    const map = {
        sprint: 'sprint',
        weekly: 'weekly',
        executive: 'executive',
        standup: 'standup',
        retro: 'retro',
        retrospective: 'retro',
        release: 'release',
        'release-notes': 'release',
    };
    return map[s] ?? 'weekly';
}
export function registerContextCommand(program) {
    program
        .command('context')
        .description('Print stakeholder report context pack as JSON')
        .option('--report-type <type>', 'logical report type for placeholders', 'weekly')
        .option('--sprint <id>', 'sprint id')
        .option('--days <n>', 'GitHub lookback days', '7')
        .option('--no-github', 'omit GitHub signals')
        .action(async (opts) => {
        const projectDir = program.opts().projectDir;
        const config = await loadConfig(projectDir);
        const reportType = parseReportType(opts.reportType);
        const days = Math.max(1, Number.parseInt(opts.days, 10) || 7);
        const includeGitHub = opts.github !== false;
        const ctx = await buildStakeholderReportContext(projectDir, config, {
            reportType,
            days,
            sprintId: opts.sprint,
            includeGitHub,
        });
        process.stdout.write(`${JSON.stringify(ctx, null, 2)}\n`);
        logger.dim(`context: ${ctx.evidence.length} evidence items`);
    });
}
//# sourceMappingURL=context.js.map