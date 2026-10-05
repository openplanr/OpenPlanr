import type { Command } from 'commander';
import { isNonInteractive } from '../../services/interactive-state.js';
import { promptConfirm } from '../../services/prompt-service.js';
import { summarizeRuntimeChanges } from '../../services/runtime-change-summary.js';
import {
  applySetup,
  cleanupHomeProjectInstall,
  installedRuntimeScopes,
  isOpenPlanrHome,
  previewHomeProjectCleanup,
  runtimeDoctor,
  runtimeRoot,
  type SetupOptions,
  type SetupPreview,
} from '../../services/runtime-manager-service.js';
import { listManagedServers } from '../../services/server-lifecycle-service.js';
import { CLI_COMMAND } from '../../utils/constants.js';
import { display, isVerbose, logger } from '../../utils/logger.js';

type Diagnosis = Awaited<ReturnType<typeof runtimeDoctor>>;
interface RepairPreview {
  homeCleanup: string[];
  daemon: Diagnosis['repairs'];
  integrations: SetupPreview | null;
}

async function previewRepairs(projectDir: string, cliVersion: string, diagnosis: Diagnosis) {
  const homeCleanup = await previewHomeProjectCleanup();
  const installed = (await installedRuntimeScopes(projectDir)).filter(
    (entry) => !isOpenPlanrHome(projectDir) || entry.scope === 'user',
  );
  const setupOptions: SetupOptions = {
    projectDir,
    cliVersion,
    runtimes: [...new Set(installed.map((entry) => entry.runtime))],
    scope: 'user',
    preserveExistingScopes: !isOpenPlanrHome(projectDir),
    skillMode: installed.find((entry) => entry.runtime === 'codex')?.skillMode,
    replaceManaged: true,
  };
  const integrations = setupOptions.runtimes?.length
    ? await applySetup({ ...setupOptions, dryRun: true })
    : null;
  const repairPreview: RepairPreview = { homeCleanup, daemon: diagnosis.repairs, integrations };
  return { setupOptions, repairPreview };
}

function printRepairPreview(preview: RepairPreview): void {
  logger.heading('Repair preview');
  preview.homeCleanup.forEach((target) => {
    display.bullet(`remove ${target}`);
  });
  preview.daemon.forEach((repair) => {
    display.bullet(`${repair.operation} ${repair.target}`);
  });
  const integrations = preview.integrations;
  if (!integrations) return;
  summarizeRuntimeChanges(integrations, { bookkeepingRoot: runtimeRoot(), applied: false }).forEach(
    (change) => {
      display.bullet(
        `${change.host} (${integrations.runtimeScopes[change.runtime]}): ${change.summary}`,
      );
    },
  );
  integrations.runtimeDiagnostics
    .filter((entry) => entry.status !== 'pass')
    .forEach((diagnostic) => {
      logger.warn(diagnostic.message);
      if (diagnostic.fix) display.line(`  ${diagnostic.fix}`);
    });
  if (!isVerbose()) return;
  integrations.actions
    .filter((entry) => entry.operation !== 'unchanged')
    .forEach((action) => {
      display.bullet(`${action.operation} ${action.target}`);
    });
}

async function applyRepairs(
  preview: RepairPreview,
  setupOptions: SetupOptions,
  integrations: boolean,
) {
  if (preview.daemon.length) {
    await runtimeDoctor(setupOptions.projectDir, { pipelineRepair: 'apply' });
  }
  if (preview.homeCleanup.length) await cleanupHomeProjectInstall();
  if (!integrations) return false;
  const applied = await applySetup(setupOptions);
  return applied.restartRequired ?? false;
}

function hasIntegrationRepairs(preview: SetupPreview | null): boolean {
  return (
    Boolean(preview?.actions.some((item) => item.operation !== 'unchanged')) ||
    (preview?.runtimeOperations.length ?? 0) > 0
  );
}

async function repairInstallation(
  projectDir: string,
  cliVersion: string,
  diagnosis: Diagnosis,
  { json, yes }: { json: boolean; yes: boolean },
) {
  const { repairPreview, setupOptions } = await previewRepairs(projectDir, cliVersion, diagnosis);
  if (!json) printRepairPreview(repairPreview);
  const integrations = repairPreview.integrations;
  const integrationRepairs = hasIntegrationRepairs(integrations);
  const hasRepairs =
    repairPreview.homeCleanup.length > 0 || repairPreview.daemon.length > 0 || integrationRepairs;
  const untouched = { ...diagnosis, repairPreview, repairsApplied: false, restartRequired: false };
  const inspectionFailures =
    integrations?.runtimeDiagnostics.filter((entry) => entry.status === 'fail') ?? [];
  if (inspectionFailures.length) {
    if (!json) logger.warn('Resolve the failed native plugin inspection before applying repairs.');
    return {
      ...untouched,
      ok: false,
      diagnostics: [
        ...diagnosis.diagnostics,
        ...inspectionFailures.map((entry) => ({
          code: `runtime-${entry.runtime}-repair`,
          status: 'fail' as const,
          message: entry.message,
          fix: entry.fix,
        })),
      ],
    };
  }
  if (!hasRepairs) {
    if (!json) logger.success('No managed repairs are needed.');
    return untouched;
  }
  const confirmed =
    yes ||
    (!isNonInteractive() &&
      (await promptConfirm('Apply these managed integration and stale-daemon repairs?', true)));
  if (!confirmed) {
    if (!json)
      logger.warn('Repairs were not applied; rerun with --yes after reviewing the preview.');
    return untouched;
  }
  const restartRequired = await applyRepairs(repairPreview, setupOptions, integrationRepairs);
  const result = await runtimeDoctor(projectDir);
  if (!json && restartRequired) {
    logger.warn('Restart the affected coding agent to reload its plugin and skill list.');
  }
  return { ...result, repairPreview, repairsApplied: true, restartRequired };
}

function printDiagnosis(result: Diagnosis): void {
  logger.heading('OpenPlanr doctor');
  result.diagnostics.forEach((diagnostic) => {
    const label = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' }[diagnostic.status];
    display.line(`  ${label.padEnd(4)} ${diagnostic.code}: ${diagnostic.message}`);
    if (diagnostic.fix) display.line(`       Fix: ${diagnostic.fix}`);
  });
}

export function registerDoctorCommand(program: Command, cliVersion: string) {
  program
    .command('doctor')
    .description('Diagnose OpenPlanr, pipeline, runtime adapter, and project health')
    .option('--strict', 'treat warnings as failures', false)
    .option('--fix', 'preview and repair managed integrations and stale daemon state', false)
    .option('--json', 'machine-readable output', false)
    .option(
      '--yes',
      'apply previewed managed integration and stale-daemon repairs without confirmation',
      false,
    )
    .action(async (opts) => {
      const projectDir = program.opts().projectDir as string;
      const diagnosis = await runtimeDoctor(
        projectDir,
        opts.fix ? { pipelineRepair: 'preview' } : undefined,
      );
      const repaired = opts.fix
        ? await repairInstallation(projectDir, cliVersion, diagnosis, {
            json: opts.json,
            yes: opts.yes || program.opts().yes,
          })
        : diagnosis;
      let serverDiagnostic: Diagnosis['diagnostics'][number];
      let servers = [] as Awaited<ReturnType<typeof listManagedServers>>;
      try {
        servers = await listManagedServers();
        serverDiagnostic = {
          code: 'owned-local-servers',
          status: 'pass',
          message: `${servers.length} owned local service${servers.length === 1 ? '' : 's'} running.`,
          ...(servers.length
            ? {
                fix: `Use ${CLI_COMMAND} server list to inspect them and ${CLI_COMMAND} server stop <instance> to stop one.`,
              }
            : {}),
        };
      } catch {
        serverDiagnostic = {
          code: 'owned-local-servers',
          status: 'warn',
          message: 'Local service discovery is unavailable.',
          fix: `Run ${CLI_COMMAND} server list for the recovery details.`,
        };
      }
      const result = {
        ...repaired,
        servers,
        diagnostics: [...repaired.diagnostics, serverDiagnostic],
      };
      if (opts.json) display.line(JSON.stringify(result));
      else printDiagnosis(result);
      if (
        !result.ok ||
        (opts.strict && result.diagnostics.some((item) => item.status === 'warn'))
      ) {
        process.exitCode = 1;
      }
    });
}
