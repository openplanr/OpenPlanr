import chalk from 'chalk';
import type { Command } from 'commander';
import { parseTaskMarkdown } from '../../agents/task-parser.js';
import { listArtifacts, readArtifact, readArtifactRaw } from '../../services/artifact-service.js';
import { loadConfig } from '../../services/config-service.js';
import { logger } from '../../utils/logger.js';

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
      console.log('');

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
          console.log('');
          console.log(chalk.bold.cyan(`  ${epic.id}: ${epic.title}`));

          // Features under this epic
          const epicFeatures = features.filter((f) => featureToEpic.get(f.id) === epic.id);
          if (epicFeatures.length > 0) {
            const featureList = showAll ? epicFeatures : epicFeatures.slice(0, 5);
            for (const f of featureList) {
              console.log(chalk.white(`    ${f.id}  ${f.title}`));

              // Stories under this feature
              const featureStories = stories.filter((s) => storyToFeature.get(s.id) === f.id);
              const storyList = showAll ? featureStories : featureStories.slice(0, 3);
              for (const s of storyList) {
                console.log(chalk.dim(`      ${s.id}  ${s.title}`));
              }
              if (!showAll && featureStories.length > 3) {
                console.log(chalk.dim(`      ... and ${featureStories.length - 3} more stories`));
              }
            }
            if (!showAll && epicFeatures.length > 5) {
              console.log(chalk.dim(`    ... and ${epicFeatures.length - 5} more features`));
            }
          }
        }

        // Show orphaned features (no epic parent)
        const orphanFeatures = features.filter((f) => !featureToEpic.has(f.id));
        if (orphanFeatures.length > 0) {
          console.log('');
          console.log(chalk.yellow(`  Unlinked Features: ${orphanFeatures.length}`));
          for (const f of showAll ? orphanFeatures : orphanFeatures.slice(0, 5)) {
            console.log(chalk.dim(`    ${f.id}  ${f.title}`));
          }
        }

        // Show orphaned stories (no feature parent)
        const orphanStories = stories.filter((s) => !storyToFeature.has(s.id));
        if (orphanStories.length > 0) {
          console.log('');
          console.log(chalk.yellow(`  Unlinked Stories: ${orphanStories.length}`));
          for (const s of showAll ? orphanStories : orphanStories.slice(0, 5)) {
            console.log(chalk.dim(`    ${s.id}  ${s.title}`));
          }
        }
      } else {
        // No epics — flat listing fallback
        printSection('Features', features, showAll);
        printSection('User Stories', stories, showAll);
      }

      // Task lists with completion metrics
      console.log('');
      const taskIcon = tasks.length > 0 ? '●' : '○';
      console.log(`  ${taskIcon} Task Lists: ${tasks.length}`);
      if (tasks.length > 0) {
        const taskList = showAll ? tasks : tasks.slice(0, 5);
        for (const t of taskList) {
          const metrics = taskMetrics.get(t.id);
          if (metrics && metrics.total > 0) {
            const pct = Math.round((metrics.done / metrics.total) * 100);
            const progressText = `(${metrics.done}/${metrics.total} subtasks, ${pct}%)`;
            const coloredProgress = colorByPercent(progressText, pct);
            console.log(`    ${t.id}  ${t.title}  ${coloredProgress}`);
          } else {
            console.log(`    ${t.id}  ${t.title}`);
          }
        }
        if (!showAll && tasks.length > 5) {
          console.log(chalk.dim(`    ... and ${tasks.length - 5} more`));
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
          console.log('');
          console.log(
            `  ${colorByPercent(`Overall: ${totalDone}/${totalSubtasks} subtasks complete (${overallPct}%)`, overallPct)}`,
          );
        }
      }

      // Quick tasks (standalone, outside hierarchy)
      const quickTasks = await listArtifacts(projectDir, config, 'quick');
      if (quickTasks.length > 0) {
        console.log('');
        console.log(`  ● Quick Tasks: ${quickTasks.length}`);
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
              console.log(
                `    ${qt.id}  ${qt.title}  ${colorByPercent(`(${done}/${total}, ${pct}%)`, pct)}`,
              );
            } else {
              console.log(`    ${qt.id}  ${qt.title}`);
            }
          } else {
            console.log(`    ${qt.id}  ${qt.title}`);
          }
        }
        if (!showAll && quickTasks.length > 5) {
          console.log(chalk.dim(`    ... and ${quickTasks.length - 5} more`));
        }
      }

      // Summary counts
      const quickCount = quickTasks.length > 0 ? `, ${quickTasks.length} quick tasks` : '';
      console.log('');
      console.log(
        chalk.dim(
          `  Totals: ${epics.length} epics, ${features.length} features, ${stories.length} stories, ${tasks.length} task lists${quickCount}`,
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
  console.log(`  ${icon} ${label}: ${count}`);
  if (count > 0) {
    const list = showAll ? items : items.slice(0, 5);
    for (const item of list) {
      console.log(`    ${item.id}  ${item.title}`);
    }
    if (!showAll && count > 5) {
      console.log(chalk.dim(`    ... and ${count - 5} more`));
    }
  }
}

function colorByPercent(text: string, pct: number): string {
  if (pct >= 75) return chalk.green(text);
  if (pct >= 25) return chalk.yellow(text);
  return chalk.red(text);
}
