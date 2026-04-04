import chalk from 'chalk';
import type { Command } from 'commander';
import { parseTaskMarkdown } from '../../agents/task-parser.js';
import { listArtifacts, readArtifact, readArtifactRaw } from '../../services/artifact-service.js';
import { loadConfig } from '../../services/config-service.js';
import { display, logger } from '../../utils/logger.js';
import { parseMarkdown } from '../../utils/markdown.js';

export function registerStatusCommand(program: Command) {
  program
    .command('status')
    .description('Show project planning status')
    .option('--all', 'show all items without truncation')
    .action(async (opts) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);
      const showAll = !!opts.all;

      logger.heading(`OpenPlanr Status — ${config.projectName}`);
      display.blank();

      // Gather all artifacts
      const epics = await listArtifacts(projectDir, config, 'epic');
      const features = await listArtifacts(projectDir, config, 'feature');
      const stories = await listArtifacts(projectDir, config, 'story');
      const tasks = await listArtifacts(projectDir, config, 'task');

      // Build parent lookups: featureId → epicId, storyId → featureId, taskId → storyId/featureId
      const featureToEpic = new Map<string, string>();
      const storyToFeature = new Map<string, string>();
      const taskToParent = new Map<string, string>();

      for (const f of features) {
        const data = await readArtifact(projectDir, config, 'feature', f.id);
        if (data?.data.epicId) featureToEpic.set(f.id, data.data.epicId as string);
      }
      for (const s of stories) {
        const data = await readArtifact(projectDir, config, 'story', s.id);
        if (data?.data.featureId) storyToFeature.set(s.id, data.data.featureId as string);
      }
      for (const t of tasks) {
        const data = await readArtifact(projectDir, config, 'task', t.id);
        const parentStory = data?.data.storyId as string | undefined;
        const parentFeature = data?.data.featureId as string | undefined;
        if (parentStory) taskToParent.set(t.id, parentStory);
        else if (parentFeature) taskToParent.set(t.id, parentFeature);
      }

      // Task completion metrics
      const taskMetrics = new Map<string, { done: number; total: number }>();
      for (const t of tasks) {
        const raw = await readArtifactRaw(projectDir, config, 'task', t.id);
        if (raw) {
          const parsed = parseTaskMarkdown(raw);
          const subtasks = parsed.filter((s) => s.depth > 0);
          const total = subtasks.length || parsed.length;
          const done = (subtasks.length > 0 ? subtasks : parsed).filter((s) => s.done).length;
          taskMetrics.set(t.id, { done, total });
        }
      }

      // Tree view: group by epic hierarchy
      if (epics.length > 0) {
        printSection('Epics', epics, showAll);

        for (const epic of epics) {
          display.blank();
          display.line(chalk.bold.cyan(`  ${epic.id}: ${epic.title}`));

          // Features under this epic
          const epicFeatures = features.filter((f) => featureToEpic.get(f.id) === epic.id);
          if (epicFeatures.length > 0) {
            const featureList = showAll ? epicFeatures : epicFeatures.slice(0, 5);
            for (const f of featureList) {
              display.line(chalk.white(`    ${f.id}  ${f.title}`));

              // Stories under this feature
              const featureStories = stories.filter((s) => storyToFeature.get(s.id) === f.id);
              const storyList = showAll ? featureStories : featureStories.slice(0, 3);
              for (const s of storyList) {
                display.line(chalk.dim(`      ${s.id}  ${s.title}`));
              }
              if (!showAll && featureStories.length > 3) {
                display.line(chalk.dim(`      ... and ${featureStories.length - 3} more stories`));
              }
            }
            if (!showAll && epicFeatures.length > 5) {
              display.line(chalk.dim(`    ... and ${epicFeatures.length - 5} more features`));
            }
          }
        }

        // Show orphaned features (no epic parent)
        const orphanFeatures = features.filter((f) => !featureToEpic.has(f.id));
        if (orphanFeatures.length > 0) {
          display.blank();
          display.line(chalk.yellow(`  Unlinked Features: ${orphanFeatures.length}`));
          for (const f of showAll ? orphanFeatures : orphanFeatures.slice(0, 5)) {
            display.line(chalk.dim(`    ${f.id}  ${f.title}`));
          }
        }

        // Show orphaned stories (no feature parent)
        const orphanStories = stories.filter((s) => !storyToFeature.has(s.id));
        if (orphanStories.length > 0) {
          display.blank();
          display.line(chalk.yellow(`  Unlinked Stories: ${orphanStories.length}`));
          for (const s of showAll ? orphanStories : orphanStories.slice(0, 5)) {
            display.line(chalk.dim(`    ${s.id}  ${s.title}`));
          }
        }
      } else {
        // No epics — flat listing fallback
        printSection('Features', features, showAll);
        printSection('User Stories', stories, showAll);
      }

      // Task lists with completion metrics
      display.blank();
      const taskIcon = tasks.length > 0 ? '●' : '○';
      display.line(`  ${taskIcon} Task Lists: ${tasks.length}`);
      if (tasks.length > 0) {
        const taskList = showAll ? tasks : tasks.slice(0, 5);
        for (const t of taskList) {
          const metrics = taskMetrics.get(t.id);
          if (metrics && metrics.total > 0) {
            const pct = Math.round((metrics.done / metrics.total) * 100);
            const progressText = `(${metrics.done}/${metrics.total} subtasks, ${pct}%)`;
            const coloredProgress = colorByPercent(progressText, pct);
            display.line(`    ${t.id}  ${t.title}  ${coloredProgress}`);
          } else {
            display.line(`    ${t.id}  ${t.title}`);
          }
        }
        if (!showAll && tasks.length > 5) {
          display.line(chalk.dim(`    ... and ${tasks.length - 5} more`));
        }

        // Overall task completion summary
        let totalDone = 0;
        let totalSubtasks = 0;
        for (const m of taskMetrics.values()) {
          totalDone += m.done;
          totalSubtasks += m.total;
        }
        if (totalSubtasks > 0) {
          const overallPct = Math.round((totalDone / totalSubtasks) * 100);
          display.blank();
          display.line(
            `  ${colorByPercent(`Overall: ${totalDone}/${totalSubtasks} subtasks complete (${overallPct}%)`, overallPct)}`,
          );
        }
      }

      // Backlog items
      const backlogItems = await listArtifacts(projectDir, config, 'backlog');
      if (backlogItems.length > 0) {
        display.blank();
        display.line(`  ${chalk.red('●')} Backlog: ${backlogItems.length}`);
        const blList = showAll ? backlogItems : backlogItems.slice(0, 5);
        for (const bl of blList) {
          const blRaw = await readArtifactRaw(projectDir, config, 'backlog', bl.id);
          const priority = blRaw
            ? (parseMarkdown(blRaw).data.priority as string) || 'medium'
            : 'medium';
          const priorityColor =
            priority === 'critical' ? chalk.red : priority === 'high' ? chalk.yellow : chalk.dim;
          display.line(`    ${bl.id}  ${bl.title}  ${priorityColor(`[${priority}]`)}`);
        }
        if (!showAll && backlogItems.length > 5) {
          display.line(chalk.dim(`    ... and ${backlogItems.length - 5} more`));
        }
      }

      // Sprint
      const sprints = await listArtifacts(projectDir, config, 'sprint');
      const activeSprint =
        sprints.length > 0
          ? await (async () => {
              for (const s of sprints) {
                const sRaw = await readArtifactRaw(projectDir, config, 'sprint', s.id);
                if (sRaw && (parseMarkdown(sRaw).data.status as string) === 'active') {
                  return { ...s, data: parseMarkdown(sRaw).data };
                }
              }
              return null;
            })()
          : null;

      if (activeSprint) {
        display.blank();
        const sprintName = (activeSprint.data.name as string) || activeSprint.title;
        const endDate = activeSprint.data.endDate as string | undefined;
        let remaining = '';
        if (endDate) {
          const daysLeft = Math.ceil(
            (new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
          );
          remaining = daysLeft > 0 ? chalk.yellow(` (${daysLeft}d left)`) : chalk.red(' (ended)');
        }
        display.line(
          `  ${chalk.blueBright('●')} Active Sprint: ${activeSprint.id} — ${sprintName}${remaining}`,
        );
      }

      // Quick tasks (standalone, outside hierarchy)
      const quickTasks = await listArtifacts(projectDir, config, 'quick');
      if (quickTasks.length > 0) {
        display.blank();
        display.line(`  ● Quick Tasks: ${quickTasks.length}`);
        const quickList = showAll ? quickTasks : quickTasks.slice(0, 5);
        for (const qt of quickList) {
          const raw = await readArtifactRaw(projectDir, config, 'quick', qt.id);
          if (raw) {
            const parsed = parseTaskMarkdown(raw);
            const subtasks = parsed.filter((s) => s.depth > 0);
            const total = subtasks.length || parsed.length;
            const done = (subtasks.length > 0 ? subtasks : parsed).filter((s) => s.done).length;
            if (total > 0) {
              const pct = Math.round((done / total) * 100);
              display.line(
                `    ${qt.id}  ${qt.title}  ${colorByPercent(`(${done}/${total}, ${pct}%)`, pct)}`,
              );
            } else {
              display.line(`    ${qt.id}  ${qt.title}`);
            }
          } else {
            display.line(`    ${qt.id}  ${qt.title}`);
          }
        }
        if (!showAll && quickTasks.length > 5) {
          display.line(chalk.dim(`    ... and ${quickTasks.length - 5} more`));
        }
      }

      // Summary counts
      const quickCount = quickTasks.length > 0 ? `, ${quickTasks.length} quick tasks` : '';
      const blCount = backlogItems.length > 0 ? `, ${backlogItems.length} backlog` : '';
      const sprintCount =
        sprints.length > 0 ? `, ${sprints.length} sprint${sprints.length !== 1 ? 's' : ''}` : '';
      display.blank();
      display.line(
        chalk.dim(
          `  Totals: ${epics.length} epics, ${features.length} features, ${stories.length} stories, ${tasks.length} task lists${quickCount}${blCount}${sprintCount}`,
        ),
      );
      logger.dim(`Targets: ${config.targets.join(', ')}`);
      logger.dim(`Artifacts: ${config.outputPaths.agile}/`);
    });
}

function printSection(
  label: string,
  items: Array<{ id: string; title: string }>,
  showAll: boolean,
) {
  const count = items.length;
  const icon = count > 0 ? '●' : '○';
  display.line(`  ${icon} ${label}: ${count}`);
  if (count > 0) {
    const list = showAll ? items : items.slice(0, 5);
    for (const item of list) {
      display.line(`    ${item.id}  ${item.title}`);
    }
    if (!showAll && count > 5) {
      display.line(chalk.dim(`    ... and ${count - 5} more`));
    }
  }
}

function colorByPercent(text: string, pct: number): string {
  if (pct >= 75) return chalk.green(text);
  if (pct >= 25) return chalk.yellow(text);
  return chalk.red(text);
}
