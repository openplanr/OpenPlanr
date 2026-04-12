/**
 * `planr backlog` command group.
 *
 * Lightweight issue/TODO tracker with tags, priorities, and
 * AI-powered prioritization. The intake funnel before work
 * enters the agile hierarchy.
 */

import chalk from 'chalk';
import type { Command } from 'commander';
import { buildBacklogPrioritizePrompt } from '../../ai/prompts/prompt-builder.js';
import { aiBacklogPrioritizeResponseSchema } from '../../ai/schemas/ai-response-schemas.js';
import { TOKEN_BUDGETS } from '../../ai/types.js';
import type { BacklogPriority, OpenPlanrConfig } from '../../models/types.js';
import { generateStreamingJSON, getAIProvider, isAIConfigured } from '../../services/ai-service.js';
import {
  createArtifact,
  listArtifacts,
  readArtifact,
  readArtifactRaw,
  updateArtifact,
  updateArtifactFields,
} from '../../services/artifact-service.js';
import { loadConfig } from '../../services/config-service.js';
import { promptConfirm } from '../../services/prompt-service.js';
import { VALID_STATUSES } from '../../utils/constants.js';
import { display, logger } from '../../utils/logger.js';
import { parseMarkdown } from '../../utils/markdown.js';

const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const PRIORITY_COLORS: Record<string, (text: string) => string> = {
  critical: chalk.red.bold,
  high: chalk.yellow,
  medium: chalk.blue,
  low: chalk.dim,
};

export function registerBacklogCommand(program: Command) {
  const backlog = program.command('backlog').description('Capture and prioritize incoming work');

  // -----------------------------------------------------------------------
  // planr backlog add "description"
  // -----------------------------------------------------------------------
  backlog
    .command('add')
    .description('Add a new backlog item')
    .argument('<description>', 'brief description of the work')
    .option('-p, --priority <level>', 'priority: critical, high, medium, low', 'medium')
    .option('-t, --tag <tags...>', 'tags (e.g., bug, feature, tech-debt)')
    .action(async (description: string, opts) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      const priority = validatePriority(opts.priority);
      if (!priority) return;

      const tags: string[] = opts.tag || [];
      const title = truncateTitle(description);

      const { id, filePath } = await createArtifact(
        projectDir,
        config,
        'backlog',
        'backlog/backlog-item.md.hbs',
        { title, priority, tags, description },
      );

      logger.success(`Added ${id}: ${title}`);
      logger.dim(`  Priority: ${priority} | Tags: ${tags.join(', ') || 'none'}`);
      logger.dim(`  ${filePath}`);
    });

  // -----------------------------------------------------------------------
  // planr backlog list
  // -----------------------------------------------------------------------
  backlog
    .command('list')
    .description('List backlog items')
    .option('-t, --tag <tag>', 'filter by tag')
    .option('-p, --priority <level>', 'filter by priority')
    .option('-s, --status <status>', 'filter by status (open, promoted, closed)', 'open')
    .action(async (opts) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      const items = await loadBacklogItems(projectDir, config);
      let filtered = items;

      if (opts.status) {
        filtered = filtered.filter((i) => i.status === opts.status);
      }
      if (opts.tag) {
        filtered = filtered.filter((i) => i.tags.includes(opts.tag));
      }
      if (opts.priority) {
        filtered = filtered.filter((i) => i.priority === opts.priority);
      }

      if (filtered.length === 0) {
        logger.info('No backlog items found. Run "planr backlog add <description>" to add one.');
        return;
      }

      // Sort by priority
      filtered.sort(
        (a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9),
      );

      logger.heading(`Backlog (${filtered.length} items)`);
      display.blank();

      for (const item of filtered) {
        const colorFn = PRIORITY_COLORS[item.priority] || chalk.white;
        const priorityBadge = colorFn(`[${item.priority.toUpperCase()}]`);
        const tagStr =
          item.tags.length > 0 ? chalk.dim(` ${item.tags.map((t) => `#${t}`).join(' ')}`) : '';
        display.line(`  ${chalk.bold(item.id)}  ${item.title}  ${priorityBadge}${tagStr}`);
      }
      display.blank();
    });

  // -----------------------------------------------------------------------
  // planr backlog prioritize
  // -----------------------------------------------------------------------
  backlog
    .command('prioritize')
    .description('AI-powered prioritization of open backlog items')
    .action(async () => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      if (!isAIConfigured(config)) {
        logger.error('AI not configured. Run `planr config set-provider` first.');
        return;
      }

      const items = await loadBacklogItems(projectDir, config);
      const openItems = items.filter((i) => i.status === 'open');

      if (openItems.length < 2) {
        logger.info('Need at least 2 open backlog items to prioritize.');
        return;
      }

      logger.heading('Backlog Prioritization (AI-powered)');
      logger.dim(`Analyzing ${openItems.length} open items...`);

      try {
        const provider = await getAIProvider(config);
        const messages = buildBacklogPrioritizePrompt(openItems);

        const { result } = await generateStreamingJSON(
          provider,
          messages,
          aiBacklogPrioritizeResponseSchema,
          { maxTokens: TOKEN_BUDGETS.backlogPrioritize },
        );

        // Display prioritized list
        display.separator(60);
        display.heading('  Recommended Priority Order:');
        display.blank();

        for (const item of result.items) {
          const colorFn = PRIORITY_COLORS[item.priority] || chalk.white;
          const badge = colorFn(`[${item.priority.toUpperCase()}]`);
          const impact = chalk.green(`impact:${item.impactScore}`);
          const effort = chalk.yellow(`effort:${item.effortScore}`);
          display.line(`  ${chalk.bold(item.id)}  ${badge}  ${impact}  ${effort}`);
          display.line(chalk.dim(`    ${item.reasoning}`));
        }

        display.blank();
        display.line(chalk.dim(`  ${result.summary}`));
        display.separator(60);

        const apply = await promptConfirm('Apply these priority changes?', true);
        if (!apply) {
          logger.info('Prioritization cancelled.');
          return;
        }

        // Apply priority changes
        let updated = 0;
        for (const rec of result.items) {
          const item = openItems.find((i) => i.id === rec.id);
          if (!item || item.priority === rec.priority) continue;

          const raw = await readArtifactRaw(projectDir, config, 'backlog', rec.id);
          if (!raw) continue;

          const newRaw = raw.replace(/^priority: ".*"$/m, `priority: "${rec.priority}"`);
          await updateArtifact(projectDir, config, 'backlog', rec.id, newRaw);
          updated++;
        }

        logger.success(`Updated ${updated} item${updated !== 1 ? 's' : ''}`);
      } catch (err) {
        const { AIError } = await import('../../ai/errors.js');
        if (err instanceof AIError) {
          logger.error(err.userMessage);
        } else {
          throw err;
        }
      }
    });

  // -----------------------------------------------------------------------
  // planr backlog promote <blId>
  // -----------------------------------------------------------------------
  backlog
    .command('promote')
    .description('Promote a backlog item to story or quick task')
    .argument('<blId>', 'backlog item ID (e.g., BL-001)')
    .option('--story', 'promote to a new user story (requires --feature)')
    .option('--quick', 'promote to a standalone quick task')
    .option('--feature <featureId>', 'parent feature for story promotion')
    .action(async (blId: string, opts) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      if (!opts.story && !opts.quick) {
        logger.error('Specify --story or --quick to choose promotion target.');
        return;
      }

      const data = await readArtifact(projectDir, config, 'backlog', blId);
      if (!data) {
        logger.error(`Backlog item ${blId} not found.`);
        return;
      }

      const title = (data.data.title as string) || blId;
      const description = (data.data.description as string) || title;

      if (opts.quick) {
        // Promote to quick task
        const { id, filePath } = await createArtifact(
          projectDir,
          config,
          'quick',
          'quick/quick-task.md.hbs',
          {
            title,
            tasks: [{ id: '1.0', title: description, status: 'pending', subtasks: [] }],
          },
        );

        await markPromoted(projectDir, config, blId, id);
        logger.success(`Promoted ${blId} -> ${id}`);
        logger.dim(`  ${filePath}`);
        logger.dim(`  Next: Open ${id} in your coding agent for implementation`);
      } else if (opts.story) {
        if (!opts.feature) {
          logger.error('Story promotion requires --feature <featureId>.');
          return;
        }

        const feature = await readArtifact(projectDir, config, 'feature', opts.feature);
        if (!feature) {
          logger.error(`Feature ${opts.feature} not found.`);
          return;
        }

        const { id, filePath } = await createArtifact(
          projectDir,
          config,
          'story',
          'stories/user-story.md.hbs',
          {
            title,
            featureId: opts.feature,
            role: 'developer',
            goal: description,
            benefit: 'complete the backlog item',
            additionalNotes: `Promoted from backlog item ${blId}`,
            gherkinScenarios: [],
          },
        );

        const { addChildReference } = await import('../../services/artifact-service.js');
        await addChildReference(projectDir, config, 'feature', opts.feature, 'story', id, title);
        await markPromoted(projectDir, config, blId, id);

        logger.success(`Promoted ${blId} -> ${id}`);
        logger.dim(`  ${filePath}`);
        logger.dim(`  Linked to feature ${opts.feature}`);
        logger.dim(`  Next: planr task create --story ${id}`);
      }
    });

  // -----------------------------------------------------------------------
  // planr backlog close <blId>
  // -----------------------------------------------------------------------
  backlog
    .command('close')
    .description('Close/archive a backlog item')
    .argument('<blId>', 'backlog item ID (e.g., BL-001)')
    .action(async (blId: string) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      const raw = await readArtifactRaw(projectDir, config, 'backlog', blId);
      if (!raw) {
        logger.error(`Backlog item ${blId} not found.`);
        return;
      }

      const updated = raw.replace(/^status: "open"$/m, 'status: "closed"');
      if (updated === raw) {
        logger.warn(`${blId} is not in "open" status.`);
        return;
      }

      await updateArtifact(projectDir, config, 'backlog', blId, updated);
      logger.success(`Closed ${blId}`);
    });

  // -----------------------------------------------------------------------
  // planr backlog update <blId>
  // -----------------------------------------------------------------------
  backlog
    .command('update')
    .description('Update a backlog item')
    .argument('<blId>', 'backlog item ID (e.g., BL-001)')
    .option('--status <status>', 'new status (open, closed, promoted)')
    .option('--priority <priority>', 'new priority (critical, high, medium, low)')
    .action(async (blId: string, opts: { status?: string; priority?: string }) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      if (!opts.status && !opts.priority) {
        logger.error('Provide --status <value> and/or --priority <value>.');
        process.exit(1);
      }

      if (opts.status) {
        const allowed = VALID_STATUSES.backlog;
        if (allowed && !allowed.includes(opts.status)) {
          logger.error(`Invalid status "${opts.status}". Valid: ${allowed.join(', ')}`);
          process.exit(1);
        }
      }

      if (opts.priority) {
        const validPriorities = ['critical', 'high', 'medium', 'low'];
        if (!validPriorities.includes(opts.priority)) {
          logger.error(`Invalid priority "${opts.priority}". Valid: ${validPriorities.join(', ')}`);
          process.exit(1);
        }
      }

      const fields: Record<string, unknown> = {};
      if (opts.status) fields.status = opts.status;
      if (opts.priority) fields.priority = opts.priority;

      try {
        await updateArtifactFields(projectDir, config, 'backlog', blId, fields);
        const summary = Object.entries(fields)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ');
        logger.success(`Updated ${blId}: ${summary}`);
      } catch (err) {
        logger.error(`Failed to update ${blId}: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface BacklogItemSummary {
  id: string;
  title: string;
  priority: string;
  tags: string[];
  status: string;
  description: string;
}

async function loadBacklogItems(
  projectDir: string,
  config: OpenPlanrConfig,
): Promise<BacklogItemSummary[]> {
  const artifacts = await listArtifacts(projectDir, config, 'backlog');
  const items: BacklogItemSummary[] = [];

  for (const artifact of artifacts) {
    const raw = await readArtifactRaw(projectDir, config, 'backlog', artifact.id);
    if (!raw) continue;

    const { data, content } = parseMarkdown(raw);
    items.push({
      id: artifact.id,
      title: (data.title as string) || artifact.title,
      priority: (data.priority as string) || 'medium',
      tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
      status: (data.status as string) || 'open',
      description: content.slice(0, 500),
    });
  }

  return items;
}

async function markPromoted(
  projectDir: string,
  config: OpenPlanrConfig,
  blId: string,
  targetId: string,
): Promise<void> {
  const raw = await readArtifactRaw(projectDir, config, 'backlog', blId);
  if (!raw) return;

  const today = new Date().toISOString().split('T')[0];
  const updated = raw
    .replace(/^status: "open"$/m, 'status: "promoted"')
    .concat(`\n\n> **Promoted** to ${targetId} on ${today}.\n`);

  await updateArtifact(projectDir, config, 'backlog', blId, updated);
}

function validatePriority(input: string): BacklogPriority | null {
  const valid: BacklogPriority[] = ['critical', 'high', 'medium', 'low'];
  if (valid.includes(input as BacklogPriority)) return input as BacklogPriority;
  logger.error(`Invalid priority: ${input}. Must be: ${valid.join(', ')}`);
  return null;
}

/** Extract a short title (max 60 chars at word boundary) from a long description. */
function truncateTitle(description: string, maxLength = 60): string {
  if (!description) return 'Untitled';
  // If it's already short, use as-is
  if (description.length <= maxLength) return description;

  const truncated = description.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > 20 ? `${truncated.slice(0, lastSpace)}...` : `${truncated}...`;
}
