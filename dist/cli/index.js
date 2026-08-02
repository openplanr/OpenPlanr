import { Command, CommanderError } from 'commander';
import { ConfigNotFoundError, findProjectRoot } from '../services/config-service.js';
import { setNonInteractive } from '../services/interactive-state.js';
import { RuntimeManagerError } from '../services/runtime-manager-service.js';
import { display, logger, setVerbose } from '../utils/logger.js';
import { OPENPLANR_VERSION } from '../utils/package-version.js';
import { registerArtifactCommand } from './commands/artifact.js';
import { registerBacklogCommand } from './commands/backlog.js';
import { registerChecklistCommand } from './commands/checklist.js';
import { registerConfigCommand } from './commands/config.js';
import { registerContextCommand } from './commands/context.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerEpicCommand } from './commands/epic.js';
import { registerEstimateCommand } from './commands/estimate.js';
import { registerExportCommand } from './commands/export.js';
import { registerFeatureCommand } from './commands/feature.js';
import { registerGitHubCommand } from './commands/github.js';
import { registerGraphCommand } from './commands/graph.js';
import { registerInitCommand } from './commands/init.js';
import { registerLinearCommand } from './commands/linear.js';
import { registerOperateCommand } from './commands/operate.js';
import { registerPipelineCommand } from './commands/pipeline.js';
import { registerPlanCommand } from './commands/plan.js';
import { registerQuickCommand } from './commands/quick.js';
import { registerRefineCommand } from './commands/refine.js';
import { registerReportCommand } from './commands/report.js';
import { registerReportLinterCommand } from './commands/report-linter.js';
import { registerReviseCommand } from './commands/revise.js';
import { registerRulesCommand } from './commands/rules.js';
import { registerRuntimeCommand } from './commands/runtime.js';
import { registerSearchCommand } from './commands/search.js';
import { registerSetupCommand } from './commands/setup.js';
import { registerSpecCommand } from './commands/spec.js';
import { registerSprintCommand } from './commands/sprint.js';
import { registerStatusCommand } from './commands/status.js';
import { registerStoryCommand } from './commands/story.js';
import { registerSyncCommand } from './commands/sync.js';
import { registerTaskCommand } from './commands/task.js';
import { registerTemplateCommand } from './commands/template.js';
import { registerUpdateCommand } from './commands/update.js';
import { registerVoiceCommand } from './commands/voice.js';
const version = OPENPLANR_VERSION;
const program = new Command();
const isOperateJsonInvocation = () => process.argv.includes('operate') && process.argv.includes('--json');
program
    .name('planr')
    .description('OpenPlanr planning CLI and cross-runtime pipeline router')
    .version(version)
    .option('--project-dir <path>', 'project root directory', findProjectRoot())
    .option('--verbose', 'verbose output', false)
    .option('--no-interactive', 'skip interactive prompts')
    .option('-y, --yes', 'auto-accept all prompts (alias for --no-interactive)');
program.exitOverride();
program.configureOutput({
    writeOut(value) {
        if (!isOperateJsonInvocation())
            process.stdout.write(value);
    },
    writeErr(value) {
        if (!isOperateJsonInvocation())
            process.stderr.write(value);
    },
});
program.hook('preAction', () => {
    if (program.opts().verbose) {
        setVerbose(true);
    }
    if (!program.opts().interactive || program.opts().yes || process.argv.includes('--json')) {
        setNonInteractive(true);
    }
});
registerInitCommand(program);
registerSetupCommand(program, version);
registerDoctorCommand(program, version);
registerRuntimeCommand(program, version);
registerPipelineCommand(program);
registerArtifactCommand(program);
registerOperateCommand(program);
registerLinearCommand(program);
registerBacklogCommand(program);
registerEpicCommand(program);
registerFeatureCommand(program);
registerStoryCommand(program);
registerTaskCommand(program);
registerQuickCommand(program);
registerSpecCommand(program);
registerChecklistCommand(program);
registerRulesCommand(program);
registerStatusCommand(program);
registerConfigCommand(program);
registerRefineCommand(program);
registerReviseCommand(program);
registerEstimateCommand(program);
registerExportCommand(program);
registerReportCommand(program);
registerReportLinterCommand(program);
registerContextCommand(program);
registerVoiceCommand(program);
registerGitHubCommand(program);
registerGraphCommand(program);
registerSearchCommand(program);
registerPlanCommand(program);
registerSprintCommand(program);
registerSyncCommand(program);
registerTemplateCommand(program);
registerUpdateCommand(program);
program.parseAsync(process.argv).catch((err) => {
    if (err instanceof CommanderError) {
        if (isOperateJsonInvocation()) {
            const helpDisplayed = err.code === 'commander.helpDisplayed';
            display.line(JSON.stringify({
                schemaVersion: '1.0.0',
                protocolVersion: '1.2.0',
                ok: helpDisplayed,
                action: helpDisplayed ? 'help' : 'command.parse',
                ...(helpDisplayed ? {} : { code: 'E_OPERATE_CONFIG_INVALID' }),
                message: helpDisplayed
                    ? 'Operating Board command help is available in human-readable mode without --json.'
                    : 'Invalid planr operate command. Use `planr operate --help` for the supported syntax.',
                state: null,
                paths: {},
                counts: {},
                warnings: [],
                nextActions: helpDisplayed ? [] : ['planr operate --help'],
                next: helpDisplayed ? [] : ['planr operate --help'],
                exitCode: helpDisplayed ? 0 : 2,
            }));
            process.exitCode = helpDisplayed ? 0 : 2;
            return;
        }
        process.exitCode = err.exitCode;
        return;
    }
    if (err instanceof ConfigNotFoundError) {
        display.line('');
        logger.warn('No OpenPlanr project found in this directory.');
        display.line('');
        display.line('  Run `planr init` to get started.');
        display.line('');
        process.exit(1);
    }
    if (err instanceof RuntimeManagerError ||
        String(err?.name).startsWith('E_') ||
        String(err?.code).startsWith('E_')) {
        const value = err instanceof RuntimeManagerError
            ? err.toJSON()
            : typeof err?.toJSON === 'function'
                ? err.toJSON()
                : { ok: false, code: err.code ?? err.name, problem: err.message };
        if (process.argv.includes('--json'))
            display.line(JSON.stringify(value));
        else {
            logger.error(`${value.code}: ${value.problem}`);
            if ('recovery' in value && value.recovery)
                display.line(`  ${value.recovery}`);
            if ('fix' in value && value.fix)
                display.line(`  ${value.fix}`);
        }
        process.exit(1);
    }
    throw err;
});
//# sourceMappingURL=index.js.map