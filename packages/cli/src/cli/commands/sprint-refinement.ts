import type { Command } from 'commander';
import { loadConfig } from '../../services/config-service.js';
import {
  type ApplyResult,
  applyRefinement,
  type CloseResult,
  closeSprint,
  diffRefinements,
  type RefinementDiff,
  type RefinementResult,
  readRefinement,
  recordRefinement,
  SprintRefinementError,
} from '../../services/sprint-refinement-service.js';
import { display, logger } from '../../utils/logger.js';

type ReadInput = (source: string) => Promise<Record<string, unknown>>;

function emit(json: boolean, action: string, result: object, text: () => void): void {
  if (json) {
    display.line(JSON.stringify({ ok: true, action, ...result }));
    return;
  }
  text();
}

function describeRefinement(result: RefinementResult): void {
  const { counts } = result;
  logger.success(
    `Refined ${result.id} (${result.refinedAt}): ${counts.inProgress} in progress, ${counts.planNext} plan next, ${counts.blocked} blocked, ${counts.closeOrDemote} close or demote, ${counts.refuted} refuted.`,
  );
  logger.dim(`  ${result.artifactPath}`);
  logger.dim(`  ${result.notePath}`);
  logger.dim(`  ${result.refinementPath}`);
}

function describeDiff(diff: RefinementDiff): void {
  logger.heading(
    `${diff.from.sprintId} (${diff.from.refinedAt}) → ${diff.to.sprintId} (${diff.to.refinedAt})`,
  );
  if (diff.moved.length === 0 && diff.added.length === 0 && diff.removed.length === 0) {
    display.line(`  No bucket changes (${diff.unchanged} unchanged).`);
    return;
  }
  for (const row of diff.moved) {
    const score = row.scoreFrom === row.scoreTo ? '' : `  score ${row.scoreFrom} → ${row.scoreTo}`;
    display.line(`  ${row.id}  ${row.from} → ${row.to}${score}`);
  }
  for (const row of diff.added) display.line(`  ${row.id}  added → ${row.bucket}`);
  for (const row of diff.removed) display.line(`  ${row.id}  removed (was ${row.bucket})`);
  display.line(`  ${diff.unchanged} unchanged`);
}

function describeClose(result: CloseResult): void {
  logger.success(`Closed ${result.id} on ${result.closedAt}.`);
  if (result.leftovers.length === 0) display.line('  No leftovers.');
  for (const leftover of result.leftovers)
    display.line(`  leftover ${leftover.id} (${leftover.reason})`);
  for (const warning of result.warnings) logger.warn(`  ${warning}`);
  logger.dim(`  ${result.refinementPath}`);
}

function describeApply(result: ApplyResult): void {
  const verb = result.dryRun ? 'Would update' : 'Updated';
  if (result.updates.length === 0) display.line(`  ${verb} no artifacts.`);
  for (const update of result.updates) {
    const fields = Object.entries(update.fields)
      .map(([key, value]) => {
        const previous =
          key === 'status'
            ? update.from.status
            : key === 'priority'
              ? update.from.priority
              : undefined;
        return previous ? `${key} ${previous} → ${value}` : `${key}=${value}`;
      })
      .join(', ');
    display.line(`  ${verb} ${update.id}: ${fields}`);
  }
  for (const skipped of result.skipped) logger.warn(`  Skipped ${skipped.id}: ${skipped.reason}`);
  if (result.dryRun) {
    logger.dim(`  Dry run; re-run with --yes to apply. Commit message: ${result.message}`);
    return;
  }
  if (result.commit?.committed)
    logger.success(`Committed ${result.commit.sha.slice(0, 12)}: ${result.message}`);
  else if (result.commit) logger.info(`Not committed: ${result.commit.reason}.`);
  else logger.dim(`  Not committed; pass --commit to commit as "${result.message}".`);
}

export function registerSprintRefinementCommands(
  program: Command,
  root: Command,
  readInput: ReadInput,
): void {
  const projectDirOf = () => program.opts().projectDir as string;

  root
    .command('refinement')
    .argument('<id>', 'sprint id, e.g. SPRINT-004')
    .description(
      'Store a refinement document: validate it, write the note and JSON, fill the sprint',
    )
    .requiredOption('--data <path>', 'refinement JSON document, or - for stdin')
    .option('--json', 'emit one machine-readable result')
    .action(async (id: string, options: { data: string; json?: boolean }) => {
      const projectDir = projectDirOf();
      const config = await loadConfig(projectDir);
      const document = await readInput(options.data);
      const result = await recordRefinement(projectDir, config, id, document);
      emit(!!options.json, 'sprint.refined', result, () => describeRefinement(result));
    });

  root
    .command('diff')
    .argument('<from>', 'earlier sprint id')
    .argument('<to>', 'later sprint id')
    .description('Show what moved between two refinement documents')
    .option('--json', 'emit one machine-readable result')
    .action(async (from: string, to: string, options: { json?: boolean }) => {
      const projectDir = projectDirOf();
      const config = await loadConfig(projectDir);
      const [before, after] = await Promise.all([
        readRefinement(projectDir, config, from),
        readRefinement(projectDir, config, to),
      ]);
      const missing = [!before && from, !after && to].filter(Boolean);
      if (!before || !after) {
        throw new SprintRefinementError(
          'E_SPRINT_REFINEMENT_MISSING',
          `No refinement document for ${missing.join(' and ')}.`,
          'Run planr sprint refinement <id> --data <refinement.json> for each sprint first.',
        );
      }
      const diff = diffRefinements(before, after);
      emit(!!options.json, 'sprint.diffed', diff, () => describeDiff(diff));
    });

  root
    .command('close')
    .argument('<id>', 'sprint id')
    .description('Close the sprint and record its leftovers for the next refinement')
    .option('--json', 'emit one machine-readable result')
    .action(async (id: string, options: { json?: boolean }) => {
      const projectDir = projectDirOf();
      const config = await loadConfig(projectDir);
      const result = await closeSprint(projectDir, config, id);
      emit(!!options.json, 'sprint.closed', result, () => describeClose(result));
    });

  root
    .command('apply')
    .argument('<id>', 'sprint id')
    .description('Write the approved status changes from the refinement document to the artifacts')
    .option('--yes', 'confirm the write-back after the host skill asked its approval question')
    .option('--dry-run', 'list the changes without writing anything')
    .option('--force', 'skip status vocabulary validation')
    .option('--commit', 'commit exactly the changed files as chore(planr): refine backlog for <id>')
    .option('--json', 'emit one machine-readable result')
    .action(
      async (
        id: string,
        options: {
          yes?: boolean;
          dryRun?: boolean;
          force?: boolean;
          commit?: boolean;
          json?: boolean;
        },
      ) => {
        const projectDir = projectDirOf();
        const config = await loadConfig(projectDir);
        const result = await applyRefinement(projectDir, config, id, {
          yes: options.yes || program.opts().yes === true,
          dryRun: options.dryRun,
          force: options.force,
          commit: options.commit,
        });
        emit(!!options.json, 'sprint.applied', result, () => describeApply(result));
      },
    );
}
