/**
 * `planr linear` — Linear.app integration command tree.
 * `init` stores a PAT, validates it, and saves the default team in
 * `.planr/config.json`. See `planr linear --help` for the full subcommand list.
 */

import chalk from 'chalk';
import type { Command } from 'commander';
import type { LinearMappingStrategy, OpenPlanrConfig } from '../../models/types.js';
import { findArtifactTypeById, readArtifact } from '../../services/artifact-service.js';
import { loadConfig, saveConfig } from '../../services/config-service.js';
import { resolveApiKey, saveCredential } from '../../services/credentials-service.js';
import { isNonInteractive } from '../../services/interactive-state.js';
import {
  collectLinearMappingTable,
  formatLinearMappingTable,
} from '../../services/linear-mapping-service.js';
import {
  formatLinearStatusSyncLine,
  runLinearTaskCheckboxSync,
  syncLinearStatusIntoArtifacts,
} from '../../services/linear-pull-service.js';
import { buildLinearPushPlan, runLinearPush } from '../../services/linear-push-service.js';
import {
  createLinearClient,
  getAvailableTeams,
  LINEAR_CREDENTIAL_KEY,
  validateTeamAccess,
  validateToken,
} from '../../services/linear-service.js';
import {
  promptMappingStrategy,
  promptSecret,
  promptSelect,
  promptStandaloneProject,
} from '../../services/prompt-service.js';
import { display, logger } from '../../utils/logger.js';

/**
 * Parse the `--as <strategy>` CLI flag value. Accepted forms:
 *   - `project`
 *   - `milestone-of:<projectId>`
 *   - `label-on:<projectId>`
 * Returns `null` if the raw value doesn't match one of these shapes.
 */
function parseStrategyFlag(
  raw: string | undefined,
): { strategy: LinearMappingStrategy; targetProjectId?: string } | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === 'project') return { strategy: 'project' };
  const milestoneMatch = trimmed.match(/^milestone-of:([0-9a-f-]{36}|\S+)$/i);
  if (milestoneMatch) {
    return { strategy: 'milestone-of', targetProjectId: milestoneMatch[1] };
  }
  const labelMatch = trimmed.match(/^label-on:([0-9a-f-]{36}|\S+)$/i);
  if (labelMatch) {
    return { strategy: 'label-on', targetProjectId: labelMatch[1] };
  }
  return null;
}

const PAT_HINT =
  'Create one at https://linear.app/settings/account/security (read access to teams; write when pushing issues).';

const LINEAR_HELP = `
${chalk.bold('Subcommands:')}
  init              Store PAT, pick team, save linear.teamId
  sync              Pull workflow status (features/stories) + bidirectional task checkboxes
  push <artifact>   Create/update Linear entities at any granularity:
                      EPIC-XXX  → project + features + stories + tasklists
                      FEAT-XXX  → feature + its stories + its tasklist
                      US-XXX    → one story sub-issue
                      TASK-XXX  → one tasklist sub-issue
  status            Show local OpenPlanr ↔ Linear mapping (no API calls)
  tasklist-sync     Sync TASK checkbox lines with Linear task-list issues

${chalk.bold('Common flags:')}
  --dry-run         Show planned work without writes (push: no API; sync: read-only to Linear, no local writes)
  --update-only     push: only update existing linked entities, never create
  --push-parents    push: if a parent is not yet in Linear, push it first without prompting

${chalk.dim('Examples:')}
  planr linear sync
  planr linear sync --dry-run
  planr linear push EPIC-001 --dry-run
  planr linear push FEAT-XXX --dry-run
  planr linear push US-054
  planr linear push TASK-015 --push-parents
  planr linear status --scope EPIC-001
`;

export function registerLinearCommand(program: Command) {
  const linear = program
    .command('linear')
    .description('Linear.app integration — init, push, sync, status mapping, task checklists')
    .addHelpText('after', LINEAR_HELP);

  linear
    .command('init')
    .description('Validate a Linear PAT, pick a team, and save settings to the project config')
    .action(async () => {
      const projectDir = program.opts().projectDir as string;
      let config: OpenPlanrConfig;
      try {
        config = await loadConfig(projectDir);
      } catch {
        logger.error('No OpenPlanr project in this directory. Run `planr init` first.');
        process.exit(1);
        return;
      }

      let token = (await resolveApiKey(LINEAR_CREDENTIAL_KEY))?.trim() ?? '';
      if (!token) {
        if (isNonInteractive()) {
          logger.error(
            `Set PLANR_LINEAR_TOKEN or store a key with the credentials service after a successful interactive \`planr linear init\`. ${PAT_HINT}`,
          );
          process.exit(1);
          return;
        }
        logger.dim(PAT_HINT);
        token = (await promptSecret('Linear personal access token:')).trim();
      }

      if (!token) {
        logger.error('A Linear personal access token is required.');
        process.exit(1);
        return;
      }

      const client = createLinearClient(token);

      let viewer: { name: string };
      try {
        viewer = await validateToken(client);
        logger.success(`Signed in to Linear as ${viewer.name}.`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error(msg);
        process.exit(1);
        return;
      }

      let teams: Awaited<ReturnType<typeof getAvailableTeams>>;
      try {
        teams = await getAvailableTeams(client);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error(msg);
        process.exit(1);
        return;
      }

      if (teams.length === 0) {
        logger.error(
          'No teams found for this account. Create or join a team in Linear, then run `planr linear init` again.',
        );
        process.exit(1);
        return;
      }

      let teamId: string;
      if (teams.length === 1) {
        teamId = teams[0].id;
        display.line(
          `Using team ${teams[0].name} (${teams[0].key}) — the only team available to this user.`,
        );
      } else {
        if (isNonInteractive()) {
          logger.error(
            'Multiple teams are available. Run `planr linear init` in an interactive terminal to choose a team, or set `linear.teamId` in `.planr/config.json` after selecting an id from the Linear UI.',
          );
          process.exit(1);
          return;
        }
        const choice = await promptSelect(
          'Which Linear team should OpenPlanr use for pushes?',
          teams.map((t) => ({ name: `${t.name} (${t.key})`, value: t.id })),
        );
        teamId = choice;
      }

      let teamInfo: { name: string; key: string };
      try {
        teamInfo = await validateTeamAccess(client, teamId);
        logger.success(`Team access ok: ${teamInfo.name} (${teamInfo.key}).`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error(msg);
        process.exit(1);
        return;
      }

      try {
        await saveCredential(LINEAR_CREDENTIAL_KEY, token);
      } catch (e) {
        logger.error(`Failed to store credentials: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
        return;
      }

      const next: OpenPlanrConfig = {
        ...config,
        linear: { teamId, teamKey: teamInfo.key },
      };
      try {
        await saveConfig(projectDir, next);
      } catch (e) {
        logger.error(`Failed to save config: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
        return;
      }

      logger.success('Linear integration is ready.');
      display.line('');
      display.line(`  teamId: ${teamId}`);
      display.line('  config:  .planr/config.json (linear.teamId, linear.teamKey)');
      display.line('  token:  credentials service (key: linear) or PLANR_LINEAR_TOKEN');
      display.line('');
      logger.dim('Next: `planr linear sync`, `planr linear push <epic>`, or `planr linear status`');
    });

  linear
    .command('sync')
    .description(
      'Pull workflow status (features & stories) from Linear, then sync task checklists bidirectionally',
    )
    .option(
      '--dry-run',
      'Read from Linear to compare, but do not write local files or update Linear issue bodies',
      false,
    )
    .option(
      '--update-only',
      'Same as default for this command (only artifacts with Linear links are considered); reserved for future use',
      false,
    )
    .option(
      '--on-conflict <mode>',
      'Task checkbox conflicts: prompt | local | linear (default: prompt)',
      'prompt',
    )
    .action(
      async (
        o: { dryRun: boolean; updateOnly: boolean; onConflict: string } & Record<string, unknown>,
      ) => {
        const projectDir = program.opts().projectDir as string;
        let config: OpenPlanrConfig;
        try {
          config = await loadConfig(projectDir);
        } catch {
          logger.error('No OpenPlanr project in this directory. Run `planr init` first.');
          process.exit(1);
          return;
        }
        if (!config.linear?.teamId) {
          logger.error('Linear is not configured. Run `planr linear init` first.');
          process.exit(1);
          return;
        }

        const dryRun = o.dryRun === true;
        const rawC = o.onConflict as string;
        const onConflict: 'prompt' | 'local' | 'linear' =
          rawC === 'local' || rawC === 'linear' ? rawC : 'prompt';

        let token = (await resolveApiKey(LINEAR_CREDENTIAL_KEY))?.trim() ?? '';
        if (!token) {
          if (isNonInteractive()) {
            logger.error(
              `Set PLANR_LINEAR_TOKEN or run \`planr linear init\` to store a token. ${PAT_HINT}`,
            );
            process.exit(1);
            return;
          }
          logger.dim(PAT_HINT);
          token = (await promptSecret('Linear personal access token:')).trim();
        }
        if (!token) {
          logger.error('A Linear personal access token is required.');
          process.exit(1);
          return;
        }

        const client = createLinearClient(token);
        try {
          await validateToken(client);
          await validateTeamAccess(client, config.linear.teamId);
        } catch (e) {
          logger.error(e instanceof Error ? e.message : String(e));
          process.exit(1);
          return;
        }

        const dryLabel = dryRun ? ' (dry run — no file or remote body writes)' : '';
        logger.heading(`Linear sync — status + task checklists${dryLabel}`);
        display.blank();

        try {
          display.line(
            `${chalk.cyan('[1/2]')} Workflow status: Linear → OpenPlanr features, stories, quick tasks, backlog`,
          );
          const statusSummary = await syncLinearStatusIntoArtifacts(projectDir, config, client, {
            dryRun,
          });
          display.line(formatLinearStatusSyncLine(statusSummary));
          if (dryRun) {
            logger.dim('  (dry run: no frontmatter `status` writes were applied)');
          }
          display.blank();

          display.line(`${chalk.cyan('[2/2]')} Task checklists: local TASK files ↔ Linear`);
          const t = await runLinearTaskCheckboxSync(projectDir, config, client, {
            dryRun,
            onConflict,
          });
          const taskLine = `Files processed: ${t.filesProcessed} | local ${dryRun ? 'would update' : 'updates'}: ${t.filesUpdatedLocal} | Linear ${dryRun ? 'would update' : 'updates'}: ${t.linearIssuesUpdated} | conflict decisions: ${t.conflictDecisions} | skipped (no issue id): ${t.skippedNoIssue} | skipped (stale id): ${t.skippedStaleId}`;
          display.line(taskLine);
          if (dryRun) {
            logger.dim('  (dry run: no TASK file or Linear description writes were applied)');
          }
          display.blank();

          if (
            statusSummary.updated === 0 &&
            t.filesUpdatedLocal === 0 &&
            t.linearIssuesUpdated === 0
          ) {
            logger.success(`Nothing to change${dryLabel || '.'}`);
          } else {
            logger.success('Linear sync complete.');
          }
        } catch (e) {
          logger.error(e instanceof Error ? e.message : String(e));
          process.exit(1);
        }
      },
    );

  linear
    .command('status')
    .description(
      'Show local OpenPlanr id ↔ Linear id/url mapping from frontmatter (no Linear API calls)',
    )
    .option(
      '--scope <epicId>',
      'Limit rows to an epic and its features, stories, and tasks in that scope',
    )
    .action(async (o: { scope?: string } & Record<string, unknown>) => {
      const projectDir = program.opts().projectDir as string;
      let config: OpenPlanrConfig;
      try {
        config = await loadConfig(projectDir);
      } catch {
        logger.error('No OpenPlanr project in this directory. Run `planr init` first.');
        process.exit(1);
        return;
      }

      const scope = typeof o.scope === 'string' && o.scope.trim() ? o.scope.trim() : undefined;
      try {
        const rows = await collectLinearMappingTable(projectDir, config, scope);
        if (rows.length === 0) {
          display.line(
            scope
              ? 'No artifacts in this scope.'
              : 'No epics, features, stories, or task files found.',
          );
        } else {
          display.line(formatLinearMappingTable(rows));
        }
        display.blank();
        logger.dim('Local frontmatter only — no network calls to Linear.');
      } catch (e) {
        logger.error(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });

  linear
    .command('push')
    .description(
      'Create or update Linear project/issues for any planning artifact (EPIC/FEAT/US/TASK)',
    )
    .argument(
      '<artifactId>',
      'Artifact id — accepts EPIC-XXX (epic + subtree), FEAT-XXX (feature + stories + tasklist), US-XXX (one story), or TASK-XXX (one tasklist)',
    )
    .option('--dry-run', 'Show what would be created/updated without calling the Linear API', false)
    .option(
      '--update-only',
      'Only update entities that already have Linear ids in frontmatter; never create new project/issues',
      false,
    )
    .option(
      '--push-parents',
      'If a parent in the chain is not yet pushed to Linear, push it first without prompting',
      false,
    )
    .option(
      '--as <strategy>',
      'Epic-only: mapping strategy. One of: project | milestone-of:<projectId> | label-on:<projectId>',
    )
    .action(
      async (
        artifactId: string,
        o: { dryRun: boolean; updateOnly: boolean; pushParents: boolean; as?: string },
      ) => {
        const projectDir = program.opts().projectDir as string;
        let config: OpenPlanrConfig;
        try {
          config = await loadConfig(projectDir);
        } catch {
          logger.error('No OpenPlanr project in this directory. Run `planr init` first.');
          process.exit(1);
          return;
        }
        if (!config.linear?.teamId) {
          logger.error('Linear is not configured. Run `planr linear init` first.');
          process.exit(1);
          return;
        }

        const header = o.dryRun ? 'Linear push (dry run)' : 'Linear push';
        logger.heading(`${header} — ${artifactId}`);
        display.blank();

        if (o.dryRun) {
          try {
            const plan = await buildLinearPushPlan(projectDir, config, artifactId, {
              updateOnly: o.updateOnly,
            });
            if (!plan) {
              logger.error(
                `Artifact not found or not supported for push: ${artifactId}. Supported prefixes: EPIC-/FEAT-/US-/TASK-.`,
              );
              process.exit(1);
              return;
            }
            const { counts, rows, scope } = plan;
            display.line(
              `Scope: ${scope} — ${counts.total} item(s) (${counts.project} project + ${counts.features} feature(s) + ${counts.stories} stor(ies) + ${counts.taskLists} task list(s), excluding skips).`,
            );
            display.blank();
            for (const r of rows) {
              const act =
                r.action === 'create'
                  ? chalk.green('create')
                  : r.action === 'update'
                    ? chalk.yellow('update')
                    : chalk.dim('skip');
              const extra = r.detail ? chalk.dim(` — ${r.detail}`) : '';
              display.line(`  [${r.kind}] ${act}  ${r.title}  (${r.artifactId})${extra}`);
            }
            display.blank();
            logger.dim('No Linear API calls were made. Run without --dry-run to apply.');
          } catch (e) {
            logger.error(e instanceof Error ? e.message : String(e));
            process.exit(1);
          }
          return;
        }

        let token = (await resolveApiKey(LINEAR_CREDENTIAL_KEY))?.trim() ?? '';
        if (!token) {
          if (isNonInteractive()) {
            logger.error(
              `Set PLANR_LINEAR_TOKEN or run \`planr linear init\` to store a token. ${PAT_HINT}`,
            );
            process.exit(1);
            return;
          }
          logger.dim(PAT_HINT);
          token = (await promptSecret('Linear personal access token:')).trim();
        }
        if (!token) {
          logger.error('A Linear personal access token is required.');
          process.exit(1);
          return;
        }

        const client = createLinearClient(token);
        try {
          await validateToken(client);
          await validateTeamAccess(client, config.linear.teamId);
        } catch (e) {
          logger.error(e instanceof Error ? e.message : String(e));
          process.exit(1);
          return;
        }

        // --as flag parsing (epic-only; ignored with a warning on other types).
        let strategyOverride = parseStrategyFlag(o.as);
        if (o.as && !strategyOverride) {
          logger.error(
            `Invalid --as value: "${o.as}". Expected "project", "milestone-of:<projectId>", or "label-on:<projectId>".`,
          );
          process.exit(1);
          return;
        }
        if (strategyOverride && findArtifactTypeById(artifactId) !== 'epic') {
          logger.warn('--as is epic-only; ignoring for this artifact.');
          strategyOverride = null;
        }

        // First-time interactive mapping-strategy prompt (epic only; skipped
        // when the epic already has a stored strategy, when --as is set, or in
        // non-interactive mode where the fallback chain in the service
        // handles it — config.defaultEpicStrategy, then 'project').
        if (
          findArtifactTypeById(artifactId) === 'epic' &&
          !strategyOverride &&
          !isNonInteractive() &&
          !config.linear.defaultEpicStrategy
        ) {
          try {
            const existing = await readArtifact(projectDir, config, 'epic', artifactId);
            const alreadyMapped = Boolean(existing?.data.linearMappingStrategy);
            if (!alreadyMapped) {
              const picked = await promptMappingStrategy(client, config.linear.teamId, artifactId);
              if (picked) strategyOverride = picked;
            }
          } catch {
            // Non-fatal: if the epic file can't be read, let the service surface the error.
          }
        }

        // First-time standalone-project prompt for QT / BL pushes.
        // Runs only when no standalone project is configured yet and the user
        // is on an interactive TTY. Non-interactive runs fall through to the
        // service's actionable "set linear.standaloneProjectId" error.
        const pushType = findArtifactTypeById(artifactId);
        if (
          (pushType === 'quick' || pushType === 'backlog') &&
          !config.linear.standaloneProjectId &&
          !isNonInteractive()
        ) {
          try {
            const picked = await promptStandaloneProject(client, config.linear.teamId);
            if (picked) {
              const next: OpenPlanrConfig = {
                ...config,
                linear: {
                  ...config.linear,
                  standaloneProjectId: picked.projectId,
                  standaloneProjectName: picked.projectName,
                },
              };
              await saveConfig(projectDir, next);
              config = next;
              logger.success(
                `Saved to .planr/config.json → linear.standaloneProjectId = ${picked.projectName}.`,
              );
            }
          } catch (e) {
            logger.warn(
              `Could not prompt for a standalone project: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }

        try {
          const plan = await runLinearPush(projectDir, config, client, artifactId, {
            updateOnly: o.updateOnly,
            pushParents: o.pushParents,
            strategyOverride: strategyOverride ?? undefined,
          });
          if (!plan) {
            logger.error(`Artifact not found or not supported for push: ${artifactId}.`);
            process.exit(1);
            return;
          }
          const { counts, rows, scope } = plan;
          display.line(
            `Done (${scope} scope): ${counts.total} item(s) — ${counts.project} project + ${counts.features} feature(s) + ${counts.stories} stor(ies) + ${counts.taskLists} task list(s) (excluding skips).`,
          );
          display.blank();
          for (const r of rows) {
            const act =
              r.action === 'create'
                ? chalk.green('create')
                : r.action === 'update'
                  ? chalk.yellow('update')
                  : chalk.dim('skip');
            const extra = r.detail ? chalk.dim(` — ${r.detail}`) : '';
            display.line(`  [${r.kind}] ${act}  ${r.title}  (${r.artifactId})${extra}`);
          }
          logger.success('Linear is up to date.');
        } catch (e) {
          logger.error(e instanceof Error ? e.message : String(e));
          process.exit(1);
        }
      },
    );

  linear
    .command('tasklist-sync')
    .description(
      'Bidirectionally sync task checkbox state between local TASK files and Linear TaskList issues',
    )
    .option(
      '--on-conflict <mode>',
      'When local and Linear differ: prompt, local, or linear (default: prompt; in CI, linear is used when not set)',
      'prompt',
    )
    .option(
      '--dry-run',
      'Show what would change without writing local files or mutating Linear issue bodies',
      false,
    )
    .action(
      async (
        o: { onConflict: 'prompt' | 'local' | 'linear'; dryRun: boolean } & Record<string, unknown>,
      ) => {
        const projectDir = program.opts().projectDir as string;
        let config: OpenPlanrConfig;
        try {
          config = await loadConfig(projectDir);
        } catch {
          logger.error('No OpenPlanr project in this directory. Run `planr init` first.');
          process.exit(1);
          return;
        }
        if (!config.linear?.teamId) {
          logger.error('Linear is not configured. Run `planr linear init` first.');
          process.exit(1);
          return;
        }

        const raw = o.onConflict as string;
        const onConflict: 'prompt' | 'local' | 'linear' =
          raw === 'local' || raw === 'linear' ? raw : 'prompt';

        let token = (await resolveApiKey(LINEAR_CREDENTIAL_KEY))?.trim() ?? '';
        if (!token) {
          if (isNonInteractive()) {
            logger.error(
              `Set PLANR_LINEAR_TOKEN or run \`planr linear init\` to store a token. ${PAT_HINT}`,
            );
            process.exit(1);
            return;
          }
          logger.dim(PAT_HINT);
          token = (await promptSecret('Linear personal access token:')).trim();
        }
        if (!token) {
          logger.error('A Linear personal access token is required.');
          process.exit(1);
          return;
        }

        const client = createLinearClient(token);
        try {
          await validateToken(client);
          await validateTeamAccess(client, config.linear.teamId);
        } catch (e) {
          logger.error(e instanceof Error ? e.message : String(e));
          process.exit(1);
          return;
        }

        const dryRun = o.dryRun === true;
        logger.heading(
          `Task checkbox sync (local TASK ↔ Linear)${dryRun ? ' (dry run — no file or remote body writes)' : ''}`,
        );
        display.blank();
        try {
          const s = await runLinearTaskCheckboxSync(projectDir, config, client, {
            onConflict,
            dryRun,
          });
          const localVerb = dryRun ? 'would update' : 'updates';
          const remoteVerb = dryRun ? 'would update' : 'updates';
          display.line(
            `Files processed: ${s.filesProcessed} | local ${localVerb}: ${s.filesUpdatedLocal} | Linear ${remoteVerb}: ${s.linearIssuesUpdated} | conflict decisions: ${s.conflictDecisions} | skipped (no issue id): ${s.skippedNoIssue} | skipped (stale id): ${s.skippedStaleId}`,
          );
          display.blank();
          if (dryRun) {
            logger.dim('Dry run — no local files or Linear issues were modified.');
          } else {
            logger.success('Task list checkbox sync complete.');
          }
        } catch (e) {
          logger.error(e instanceof Error ? e.message : String(e));
          process.exit(1);
        }
      },
    );
}
