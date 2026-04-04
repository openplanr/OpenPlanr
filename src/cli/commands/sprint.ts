/**
 * `planr sprint` command group.
 *
 * Time-boxed iterations with velocity tracking, burndown
 * metrics, and carryover management.
 */

import path from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import { buildSprintAutoSelectPrompt } from '../../ai/prompts/prompt-builder.js';
import { aiSprintAutoSelectResponseSchema } from '../../ai/schemas/ai-response-schemas.js';
import { TOKEN_BUDGETS } from '../../ai/types.js';
import type { OpenPlanrConfig } from '../../models/types.js';
import { generateStreamingJSON, getAIProvider, isAIConfigured } from '../../services/ai-service.js';
import {
  createArtifact,
  listArtifacts,
  readArtifact,
  readArtifactRaw,
  updateArtifact,
} from '../../services/artifact-service.js';
import { loadConfig } from '../../services/config-service.js';
import { promptConfirm, promptEditor, promptText } from '../../services/prompt-service.js';
import { display, logger } from '../../utils/logger.js';
import { parseMarkdown } from '../../utils/markdown.js';

export function registerSprintCommand(program: Command) {
  const sprint = program.command('sprint').description('Time-boxed sprint planning and tracking');

  // -----------------------------------------------------------------------
  // planr sprint create
  // -----------------------------------------------------------------------
  sprint
    .command('create')
    .description('Create a new sprint')
    .option('-n, --name <name>', 'sprint name')
    .option('-d, --duration <duration>', 'sprint duration (e.g., 1w, 2w)', '2w')
    .action(async (opts) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      // Enforce: only one active sprint at a time
      const existing = await loadSprints(projectDir, config);
      const activeSprint = existing.find((s) => s.status === 'active');
      if (activeSprint) {
        logger.error(
          `Sprint ${activeSprint.id} is already active. Close it first with \`planr sprint close\`.`,
        );
        return;
      }

      const name = opts.name || (await promptText('Sprint name:'));
      const duration = parseDuration(opts.duration);
      if (!duration) {
        logger.error('Invalid duration. Use format like 1w, 2w, 3w, 4w.');
        return;
      }

      const startDate = new Date().toISOString().split('T')[0];
      const endDate = addDays(new Date(), duration.days).toISOString().split('T')[0];

      const { id, filePath } = await createArtifact(
        projectDir,
        config,
        'sprint',
        'sprints/sprint.md.hbs',
        {
          title: name,
          name,
          startDate,
          endDate,
          duration: opts.duration,
          status: 'active',
          goals: [],
          taskIds: [],
        },
      );

      logger.success(`Created ${id}: ${name}`);
      logger.dim(`  ${startDate} -> ${endDate} (${opts.duration})`);
      logger.dim(`  ${filePath}`);
      logger.dim('');
      logger.heading('Next steps:');
      logger.dim(`  planr sprint add TASK-001 TASK-002   — Assign tasks`);
      logger.dim(`  planr sprint add --auto              — AI selects tasks by priority`);
      logger.dim(`  planr sprint status                  — View progress`);
    });

  // -----------------------------------------------------------------------
  // planr sprint add <taskIds...>
  // -----------------------------------------------------------------------
  sprint
    .command('add')
    .description('Add tasks to the active sprint')
    .argument('[taskIds...]', 'task IDs to add (e.g., TASK-001 QT-003)')
    .option('--auto', 'AI auto-selects tasks based on priority and velocity')
    .action(async (taskIds: string[], opts) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      const active = await getActiveSprint(projectDir, config);
      if (!active) return;

      if (opts.auto) {
        await autoSelectTasks(projectDir, config, active.id);
        return;
      }

      if (taskIds.length === 0) {
        logger.error('Provide task IDs or use --auto for AI selection.');
        return;
      }

      // Validate task IDs exist and collect metadata for display
      const validIds: string[] = [];
      const taskMeta: Record<string, { title: string; filename: string }> = {};
      for (const taskId of taskIds) {
        const prefix = taskId.split('-')[0];
        const type = prefix === 'QT' ? 'quick' : prefix === 'TASK' ? 'task' : null;
        if (!type) {
          logger.warn(`Skipping ${taskId} — only TASK-* and QT-* IDs are supported.`);
          continue;
        }
        const artifact = await readArtifact(projectDir, config, type, taskId);
        if (!artifact) {
          logger.warn(`Skipping ${taskId} — not found.`);
          continue;
        }
        validIds.push(taskId);
        const filename = path.basename(artifact.filePath);
        taskMeta[taskId] = {
          title: (artifact.data.title as string) || taskId,
          filename,
        };
      }

      if (validIds.length === 0) {
        logger.error('No valid task IDs to add.');
        return;
      }

      // Add task IDs to sprint frontmatter
      const raw = await readArtifactRaw(projectDir, config, 'sprint', active.id);
      if (!raw) return;

      const { data } = parseMarkdown(raw);
      const currentIds = Array.isArray(data.taskIds) ? (data.taskIds as string[]) : [];
      const newIds = validIds.filter((id) => !currentIds.includes(id));
      const dupes = validIds.filter((id) => currentIds.includes(id));

      if (dupes.length > 0) {
        logger.warn(`Already in sprint: ${dupes.join(', ')}`);
      }

      if (newIds.length === 0) {
        logger.info('No new tasks to add.');
        return;
      }

      const allIds = [...currentIds, ...newIds];
      let updated = raw.replace(
        /^taskIds: \[.*\]$/m,
        `taskIds: [${allIds.map((id) => `"${id}"`).join(', ')}]`,
      );

      // Also add task checkboxes to the ## Tasks section (with title + link)
      const taskLines = newIds
        .map((id) => {
          const meta = taskMeta[id];
          const prefix = id.split('-')[0];
          const dir = prefix === 'QT' ? 'quick' : 'tasks';
          if (meta) {
            return `- [ ] **${id}** ${meta.title} — [view](../${dir}/${meta.filename})`;
          }
          return `- [ ] ${id}`;
        })
        .join('\n');
      updated = updated.replace(/^_No tasks assigned yet\..*$/m, taskLines);
      // If tasks section already has items, append
      if (!updated.includes(taskLines)) {
        updated = updated.replace(/(## Tasks\n(?:- \[[ x]\] .+\n)*)/, `$1${taskLines}\n`);
      }

      await updateArtifact(projectDir, config, 'sprint', active.id, updated);
      logger.success(
        `Added ${newIds.length} task${newIds.length !== 1 ? 's' : ''} to ${active.id}`,
      );
      for (const id of newIds) {
        logger.dim(`  + ${id}`);
      }
    });

  // -----------------------------------------------------------------------
  // planr sprint status
  // -----------------------------------------------------------------------
  sprint
    .command('status')
    .description('Show active sprint progress')
    .action(async () => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      const active = await getActiveSprint(projectDir, config);
      if (!active) return;

      const raw = await readArtifactRaw(projectDir, config, 'sprint', active.id);
      if (!raw) return;

      const { data } = parseMarkdown(raw);
      const taskIds = Array.isArray(data.taskIds) ? (data.taskIds as string[]) : [];

      logger.heading(`${active.id}: ${data.name || active.title}`);
      display.blank();
      display.line(`  Duration:  ${data.duration || 'N/A'}`);
      display.line(`  Period:    ${data.startDate || '?'} -> ${data.endDate || '?'}`);

      // Calculate days remaining
      if (data.endDate) {
        const end = new Date(data.endDate as string);
        const now = new Date();
        const daysLeft = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (daysLeft > 0) {
          display.line(`  Remaining: ${chalk.yellow(`${daysLeft} days`)}`);
        } else {
          display.line(`  Remaining: ${chalk.red('Sprint ended')}`);
        }
      }

      display.line(`  Tasks:     ${taskIds.length}`);
      display.blank();

      if (taskIds.length === 0) {
        logger.dim('  No tasks assigned. Run `planr sprint add` to add tasks.');
        return;
      }

      // Compute task completion
      const { parseTaskMarkdown } = await import('../../agents/task-parser.js');
      let totalDone = 0;
      let totalSubtasks = 0;

      for (const taskId of taskIds) {
        const prefix = taskId.split('-')[0];
        const type = prefix === 'QT' ? 'quick' : 'task';
        const taskRaw = await readArtifactRaw(projectDir, config, type as 'task' | 'quick', taskId);
        if (!taskRaw) {
          display.line(`  ${chalk.red('?')} ${taskId}  ${chalk.dim('not found')}`);
          continue;
        }

        const parsed = parseTaskMarkdown(taskRaw);
        const subtasks = parsed.filter((s) => s.depth > 0);
        const total = subtasks.length || parsed.length;
        const done = (subtasks.length > 0 ? subtasks : parsed).filter((s) => s.done).length;
        totalDone += done;
        totalSubtasks += total;

        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        const icon = pct === 100 ? chalk.green('✓') : pct > 0 ? chalk.yellow('◐') : chalk.dim('○');
        const progress = total > 0 ? colorByPercent(`(${done}/${total}, ${pct}%)`, pct) : '';
        display.line(`  ${icon} ${chalk.bold(taskId)}  ${progress}`);
      }

      if (totalSubtasks > 0) {
        const overallPct = Math.round((totalDone / totalSubtasks) * 100);
        display.blank();

        // Simple progress bar
        const barWidth = 30;
        const filled = Math.round((overallPct / 100) * barWidth);
        const bar = chalk.green('█'.repeat(filled)) + chalk.dim('░'.repeat(barWidth - filled));
        display.line(`  ${bar} ${colorByPercent(`${overallPct}%`, overallPct)}`);
        display.line(chalk.dim(`  ${totalDone}/${totalSubtasks} subtasks complete`));
      }

      display.blank();
    });

  // -----------------------------------------------------------------------
  // planr sprint close
  // -----------------------------------------------------------------------
  sprint
    .command('close')
    .description('Close the active sprint and carry over incomplete tasks')
    .action(async () => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      const active = await getActiveSprint(projectDir, config);
      if (!active) return;

      const raw = await readArtifactRaw(projectDir, config, 'sprint', active.id);
      if (!raw) return;

      const { data } = parseMarkdown(raw);
      const taskIds = Array.isArray(data.taskIds) ? (data.taskIds as string[]) : [];

      // Find incomplete tasks
      const { parseTaskMarkdown } = await import('../../agents/task-parser.js');
      const incomplete: string[] = [];

      for (const taskId of taskIds) {
        const prefix = taskId.split('-')[0];
        const type = prefix === 'QT' ? 'quick' : 'task';
        const taskRaw = await readArtifactRaw(projectDir, config, type as 'task' | 'quick', taskId);
        if (!taskRaw) continue;

        const parsed = parseTaskMarkdown(taskRaw);
        const subtasks = parsed.filter((s) => s.depth > 0);
        const items = subtasks.length > 0 ? subtasks : parsed;
        const allDone = items.every((s) => s.done);
        if (!allDone) incomplete.push(taskId);
      }

      // Optional retrospective
      let retro = '';
      const addRetro = await promptConfirm('Add retrospective notes?', false);
      if (addRetro) {
        retro = await promptEditor('Sprint retrospective:');
      }

      // Update sprint status
      let updated = raw.replace(/^status: "active"$/m, 'status: "closed"');
      if (retro) {
        updated = updated.replace(/^_Complete this section when closing.*$/m, retro.trim());
      }
      await updateArtifact(projectDir, config, 'sprint', active.id, updated);

      const completedCount = taskIds.length - incomplete.length;
      logger.success(`Closed ${active.id}: ${data.name || active.title}`);
      logger.dim(`  Completed: ${completedCount}/${taskIds.length} tasks`);

      if (incomplete.length > 0) {
        display.blank();
        logger.heading('Incomplete tasks (carry over to next sprint):');
        for (const id of incomplete) {
          logger.dim(`  ${id}`);
        }
        logger.dim('');
        logger.dim('Create a new sprint and add them:');
        logger.dim(`  planr sprint create --name "Sprint N"`);
        logger.dim(`  planr sprint add ${incomplete.join(' ')}`);
      }

      // Show velocity summary
      const sprints = await loadSprints(projectDir, config);
      const closedSprints = sprints.filter((s) => s.status === 'closed');
      if (closedSprints.length >= 2) {
        display.blank();
        displayVelocityHistory(closedSprints);
      }
    });

  // -----------------------------------------------------------------------
  // planr sprint list
  // -----------------------------------------------------------------------
  sprint
    .command('list')
    .description('List all sprints')
    .action(async () => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      const sprints = await loadSprints(projectDir, config);
      if (sprints.length === 0) {
        logger.info('No sprints found. Run "planr sprint create" to start one.');
        return;
      }

      logger.heading('Sprints');
      display.blank();

      for (const s of sprints) {
        const statusColor =
          s.status === 'active' ? chalk.green : s.status === 'closed' ? chalk.dim : chalk.yellow;
        const badge = statusColor(`[${s.status.toUpperCase()}]`);
        const taskCount = chalk.dim(`(${s.taskCount} tasks)`);
        display.line(`  ${chalk.bold(s.id)}  ${s.name}  ${badge}  ${taskCount}`);
        if (s.startDate && s.endDate) {
          display.line(chalk.dim(`    ${s.startDate} -> ${s.endDate}`));
        }
      }
      display.blank();
    });

  // -----------------------------------------------------------------------
  // planr sprint history
  // -----------------------------------------------------------------------
  sprint
    .command('history')
    .description('Show velocity history across sprints')
    .action(async () => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      const sprints = await loadSprints(projectDir, config);
      const closed = sprints.filter((s) => s.status === 'closed');

      if (closed.length === 0) {
        logger.info('No closed sprints yet. Complete a sprint to see velocity history.');
        return;
      }

      logger.heading('Sprint Velocity History');
      display.blank();
      displayVelocityHistory(closed);
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SprintSummary {
  id: string;
  name: string;
  title: string;
  status: string;
  startDate?: string;
  endDate?: string;
  duration?: string;
  taskCount: number;
  taskIds: string[];
}

async function loadSprints(projectDir: string, config: OpenPlanrConfig): Promise<SprintSummary[]> {
  const artifacts = await listArtifacts(projectDir, config, 'sprint');
  const sprints: SprintSummary[] = [];

  for (const artifact of artifacts) {
    const raw = await readArtifactRaw(projectDir, config, 'sprint', artifact.id);
    if (!raw) continue;

    const { data } = parseMarkdown(raw);
    const taskIds = Array.isArray(data.taskIds) ? (data.taskIds as string[]) : [];

    sprints.push({
      id: artifact.id,
      name: (data.name as string) || artifact.title,
      title: artifact.title,
      status: (data.status as string) || 'planned',
      startDate: data.startDate as string | undefined,
      endDate: data.endDate as string | undefined,
      duration: data.duration as string | undefined,
      taskCount: taskIds.length,
      taskIds,
    });
  }

  return sprints;
}

async function getActiveSprint(
  projectDir: string,
  config: OpenPlanrConfig,
): Promise<SprintSummary | null> {
  const sprints = await loadSprints(projectDir, config);
  const active = sprints.find((s) => s.status === 'active');

  if (!active) {
    logger.error('No active sprint. Run `planr sprint create` first.');
    return null;
  }

  return active;
}

async function autoSelectTasks(
  projectDir: string,
  config: OpenPlanrConfig,
  sprintId: string,
): Promise<void> {
  if (!isAIConfigured(config)) {
    logger.error('AI not configured. Run `planr config set-provider` first.');
    return;
  }

  // Gather available tasks (not already in a sprint)
  const allSprints = await loadSprints(projectDir, config);
  const assignedIds = new Set(allSprints.flatMap((s) => s.taskIds));

  const tasks = await listArtifacts(projectDir, config, 'task');
  const quickTasks = await listArtifacts(projectDir, config, 'quick');
  const allTasks = [
    ...tasks.map((t) => ({ ...t, type: 'task' as const })),
    ...quickTasks.map((t) => ({ ...t, type: 'quick' as const })),
  ].filter((t) => !assignedIds.has(t.id));

  if (allTasks.length === 0) {
    logger.info('No unassigned tasks available.');
    return;
  }

  // Calculate velocity from past sprints
  const velocity = calculateAverageVelocity(allSprints);

  logger.dim(`Found ${allTasks.length} unassigned tasks. Target velocity: ${velocity} points.`);
  logger.dim('AI is selecting tasks...');

  try {
    const provider = await getAIProvider(config);

    // Enrich task summaries with subtask count and parent context
    const taskSummaries: Array<{ id: string; title: string; points?: number }> = [];
    for (const t of allTasks) {
      const raw = await readArtifactRaw(projectDir, config, t.type, t.id);
      let subtaskCount = 0;
      let parentInfo = '';
      if (raw) {
        const checkboxes = raw.match(/- \[[ x]\]/g);
        subtaskCount = checkboxes ? checkboxes.length : 0;
        const parentMatch = raw.match(/(?:storyId|featureId):\s*"([^"]+)"/);
        if (parentMatch) parentInfo = ` (parent: ${parentMatch[1]})`;
      }
      taskSummaries.push({
        id: t.id,
        title: `${t.title}${parentInfo} [${subtaskCount} subtasks]`,
        points: subtaskCount || 1,
      });
    }

    const messages = buildSprintAutoSelectPrompt(taskSummaries, velocity);
    const { result } = await generateStreamingJSON(
      provider,
      messages,
      aiSprintAutoSelectResponseSchema,
      { maxTokens: TOKEN_BUDGETS.sprintAutoSelect },
    );

    // Display recommendation
    display.separator(50);
    display.heading('  AI Sprint Selection:');
    display.blank();

    for (const taskId of result.selectedTaskIds) {
      const task = allTasks.find((t) => t.id === taskId);
      display.line(`  + ${chalk.bold(taskId)}  ${task?.title || ''}`);
    }

    display.blank();
    display.line(chalk.dim(`  Total: ~${result.totalPoints} points`));
    display.line(chalk.dim(`  ${result.reasoning}`));
    display.separator(50);

    const apply = await promptConfirm('Add these tasks to the sprint?', true);
    if (!apply) {
      logger.info('Cancelled.');
      return;
    }

    // Apply by reading and updating the sprint
    const raw = await readArtifactRaw(projectDir, config, 'sprint', sprintId);
    if (!raw) return;

    const { data } = parseMarkdown(raw);
    const currentIds = Array.isArray(data.taskIds) ? (data.taskIds as string[]) : [];
    const newIds = result.selectedTaskIds.filter((id) => !currentIds.includes(id));
    const allIds = [...currentIds, ...newIds];

    let updated = raw.replace(
      /^taskIds: \[.*\]$/m,
      `taskIds: [${allIds.map((id) => `"${id}"`).join(', ')}]`,
    );

    // Build rich task lines with title + link
    const taskLineEntries: string[] = [];
    for (const id of newIds) {
      const task = allTasks.find((t) => t.id === id);
      const prefix = id.split('-')[0];
      const type = prefix === 'QT' ? 'quick' : 'task';
      const dir = prefix === 'QT' ? 'quick' : 'tasks';
      const artifact = await readArtifact(projectDir, config, type, id);
      if (artifact) {
        const fname = path.basename(artifact.filePath);
        taskLineEntries.push(`- [ ] **${id}** ${task?.title || ''} — [view](../${dir}/${fname})`);
      } else {
        taskLineEntries.push(`- [ ] ${id}`);
      }
    }
    const taskLines = taskLineEntries.join('\n');
    updated = updated.replace(/^_No tasks assigned yet\..*$/m, taskLines);
    if (!updated.includes(taskLines)) {
      updated = updated.replace(/(## Tasks\n(?:- \[[ x]\] .+\n)*)/, `$1${taskLines}\n`);
    }

    await updateArtifact(projectDir, config, 'sprint', sprintId, updated);
    logger.success(`Added ${newIds.length} tasks to sprint`);
  } catch (err) {
    const { AIError } = await import('../../ai/errors.js');
    if (err instanceof AIError) {
      logger.error(err.userMessage);
    } else {
      throw err;
    }
  }
}

function calculateAverageVelocity(sprints: SprintSummary[]): number {
  const closed = sprints.filter((s) => s.status === 'closed');
  if (closed.length === 0) return 20; // Default velocity for first sprint

  // Use task count as proxy for velocity (since not all tasks have story points)
  const total = closed.reduce((sum, s) => sum + s.taskCount, 0);
  return Math.round(total / closed.length);
}

function displayVelocityHistory(closedSprints: SprintSummary[]): void {
  const maxTasks = Math.max(...closedSprints.map((s) => s.taskCount), 1);
  const barWidth = 30;

  for (const s of closedSprints) {
    const filled = Math.round((s.taskCount / maxTasks) * barWidth);
    const bar = chalk.cyan('█'.repeat(filled)) + chalk.dim('░'.repeat(barWidth - filled));
    display.line(`  ${chalk.bold(s.id)}  ${bar}  ${s.taskCount} tasks`);
  }

  const avg = calculateAverageVelocity(closedSprints);
  display.blank();
  display.line(chalk.dim(`  Average velocity: ${avg} tasks/sprint`));
}

function parseDuration(input: string): { weeks: number; days: number } | null {
  const match = input.match(/^(\d+)w$/);
  if (!match) return null;

  const weeks = Number.parseInt(match[1], 10);
  if (weeks < 1 || weeks > 4) return null;

  return { weeks, days: weeks * 7 };
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function colorByPercent(text: string, pct: number): string {
  if (pct >= 75) return chalk.green(text);
  if (pct >= 25) return chalk.yellow(text);
  return chalk.red(text);
}
