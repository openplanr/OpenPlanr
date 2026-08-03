/**
 * `planr update` command.
 *
 * Update artifact fields (status, owner, priority) from the CLI.
 * Auto-detects artifact type from the ID prefix.
 */

import type { Command } from 'commander';
import { findArtifactTypeById, updateArtifactFields } from '../../services/artifact-service.js';
import { loadConfig } from '../../services/config-service.js';
import { VALID_STATUSES } from '../../utils/constants.js';
import { logger } from '../../utils/logger.js';
import { applyBulkCheckboxes, resolveBulkStatusIntent } from '../helpers/bulk-checkbox-update.js';

export function registerUpdateCommand(program: Command) {
  program
    .command('update')
    .description('Update artifact fields (status, owner, priority)')
    .argument('<ids...>', 'one or more artifact IDs (e.g., TASK-001 FEAT-002)')
    .option('--status <status>', 'new status value')
    .option('--owner <owner>', 'new owner (epics and features only)')
    .option('--priority <priority>', 'new priority (backlog only)')
    .option(
      '--all-done',
      'set status=done AND flip every `N.M` task checkbox to `[x]` (task / quick artifacts only)',
    )
    .option(
      '--all-pending',
      'set status=pending AND flip every `N.M` task checkbox to `[ ]` (task / quick artifacts only)',
    )
    .option('--force', 'skip status validation')
    .action(
      async (
        ids: string[],
        opts: Record<string, string | boolean | undefined> & {
          allDone?: boolean;
          allPending?: boolean;
        },
      ) => {
        const projectDir = program.opts().projectDir as string;
        const config = await loadConfig(projectDir);

        // Resolve --all-done / --all-pending vs --status mutex once. If the
        // user passed a bulk flag, every id below gets the bulk treatment.
        let intent: ReturnType<typeof resolveBulkStatusIntent>;
        try {
          intent = resolveBulkStatusIntent({
            status: typeof opts.status === 'string' ? opts.status : undefined,
            allDone: opts.allDone,
            allPending: opts.allPending,
          });
        } catch (err) {
          logger.error((err as Error).message);
          process.exit(1);
          return;
        }

        if (!intent.useBulk && !opts.status && !opts.owner && !opts.priority) {
          logger.error(
            'Provide at least one of: --status, --owner, --priority, --all-done, --all-pending',
          );
          process.exit(1);
        }

        let hasError = false;

        for (const id of ids) {
          const type = findArtifactTypeById(id);
          if (!type) {
            logger.error(`Unknown artifact type for ID: ${id}`);
            hasError = true;
            continue;
          }

          // Bulk-checkbox path: applies to artifact types that have task
          // checkboxes (task, quick). Other types fall back to status-only.
          if (intent.useBulk) {
            if (type !== 'task' && type !== 'quick') {
              logger.warn(
                `--all-done / --all-pending only flip checkboxes on task / quick artifacts. ${id} (${type}) will get a status update only.`,
              );
              try {
                await updateArtifactFields(projectDir, config, type, id, {
                  status: intent.bulkStatus,
                });
                logger.success(`Updated ${id}: status=${intent.bulkStatus}`);
              } catch (err) {
                logger.error(`Failed to update ${id}: ${(err as Error).message}`);
                hasError = true;
              }
              continue;
            }
            try {
              const result = await applyBulkCheckboxes(
                projectDir,
                config,
                type,
                id,
                intent.bulkStatus,
              );
              const checkboxNote = result.flippedAny ? ' (subtasks flipped)' : '';
              logger.success(`Updated ${id}: status=${result.status}${checkboxNote}`);
            } catch (err) {
              logger.error(`Failed to update ${id}: ${(err as Error).message}`);
              hasError = true;
            }
            continue;
          }

          // Validate status
          if (opts.status && !opts.force) {
            const allowed = VALID_STATUSES[type];
            if (allowed && !allowed.includes(opts.status as string)) {
              logger.error(
                `Invalid status "${opts.status}" for ${type}. Valid: ${allowed.join(', ')}. Use --force to override.`,
              );
              hasError = true;
              continue;
            }
          }

          // Build fields object
          const fields: Record<string, unknown> = {};
          if (opts.status) fields.status = opts.status;

          if (opts.owner) {
            if (type === 'epic' || type === 'feature') {
              fields.owner = opts.owner;
            } else {
              logger.warn(
                `--owner is not applicable to ${type} artifacts. Skipping owner for ${id}.`,
              );
            }
          }

          if (opts.priority) {
            if (type === 'backlog') {
              fields.priority = opts.priority;
            } else {
              logger.warn(
                `--priority is not applicable to ${type} artifacts. Skipping priority for ${id}.`,
              );
            }
          }

          if (Object.keys(fields).length === 0) {
            logger.warn(`No applicable fields to update for ${id}.`);
            continue;
          }

          try {
            await updateArtifactFields(projectDir, config, type, id, fields);
            const fieldSummary = Object.entries(fields)
              .map(([k, v]) => `${k}=${v}`)
              .join(', ');
            logger.success(`Updated ${id}: ${fieldSummary}`);
          } catch (err) {
            logger.error(`Failed to update ${id}: ${(err as Error).message}`);
            hasError = true;
          }
        }

        if (hasError) process.exit(1);
      },
    );
}
