/**
 * `planr template` command group.
 *
 * Reusable task patterns for common development tasks.
 * Ships with 5 built-in templates and supports custom templates
 * saved from existing task lists.
 */

import path from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import type { OpenPlanrConfig } from '../../models/types.js';
import { createArtifact, readArtifactRaw } from '../../services/artifact-service.js';
import { loadConfig } from '../../services/config-service.js';
import { promptConfirm, promptText } from '../../services/prompt-service.js';
import { getTemplatesDir } from '../../utils/constants.js';
import { ensureDir, fileExists, listFiles, readFile, writeFile } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';

interface TaskTemplate {
  name: string;
  description: string;
  variables: string[];
  tasks: Array<{
    id: string;
    title: string;
    subtasks: Array<{ id: string; title: string }>;
  }>;
  source: 'built-in' | 'custom';
}

export function registerTemplateCommand(program: Command) {
  const template = program
    .command('template')
    .description('Reusable task patterns for common development tasks');

  // -----------------------------------------------------------------------
  // planr template list
  // -----------------------------------------------------------------------
  template
    .command('list')
    .description('List available task templates')
    .action(async () => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      const templates = await loadAllTemplates(projectDir, config);

      if (templates.length === 0) {
        logger.info('No templates found.');
        return;
      }

      logger.heading('Task Templates');
      console.log('');

      const builtIn = templates.filter((t) => t.source === 'built-in');
      const custom = templates.filter((t) => t.source === 'custom');

      if (builtIn.length > 0) {
        console.log(chalk.bold('  Built-in:'));
        for (const t of builtIn) {
          const taskCount = t.tasks.reduce((sum, tg) => sum + tg.subtasks.length + 1, 0);
          console.log(
            `    ${chalk.cyan(t.name)}  ${chalk.dim(`— ${t.description} (${taskCount} tasks)`)}`,
          );
        }
      }

      if (custom.length > 0) {
        console.log('');
        console.log(chalk.bold('  Custom:'));
        for (const t of custom) {
          const taskCount = t.tasks.reduce((sum, tg) => sum + tg.subtasks.length + 1, 0);
          console.log(
            `    ${chalk.green(t.name)}  ${chalk.dim(`— ${t.description} (${taskCount} tasks)`)}`,
          );
        }
      }

      console.log('');
      logger.dim('Use: planr template use <name> --title "My Task"');
    });

  // -----------------------------------------------------------------------
  // planr template show <name>
  // -----------------------------------------------------------------------
  template
    .command('show')
    .description('Preview a template')
    .argument('<name>', 'template name')
    .action(async (name: string) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      const tpl = await findTemplate(name, projectDir, config);
      if (!tpl) {
        logger.error(
          `Template "${name}" not found. Run \`planr template list\` to see available templates.`,
        );
        return;
      }

      logger.heading(`Template: ${tpl.name}`);
      console.log(chalk.dim(`  ${tpl.description}`));
      if (tpl.variables.length > 0) {
        console.log(chalk.dim(`  Variables: ${tpl.variables.join(', ')}`));
      }
      console.log('');

      for (const taskGroup of tpl.tasks) {
        console.log(chalk.bold(`  ${taskGroup.id} ${taskGroup.title}`));
        for (const sub of taskGroup.subtasks) {
          console.log(chalk.dim(`    ${sub.id} ${sub.title}`));
        }
      }
      console.log('');
    });

  // -----------------------------------------------------------------------
  // planr template use <name>
  // -----------------------------------------------------------------------
  template
    .command('use')
    .description('Generate a task list from a template')
    .argument('<name>', 'template name')
    .option('--title <title>', 'task list title')
    .action(async (name: string, opts) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      const tpl = await findTemplate(name, projectDir, config);
      if (!tpl) {
        logger.error(`Template "${name}" not found.`);
        return;
      }

      // Collect variable values
      const vars: Record<string, string> = {};
      for (const v of tpl.variables) {
        vars[v] = await promptText(`${v}:`);
      }

      const title = opts.title || (await promptText('Task list title:'));

      // Apply variable substitution
      const tasks = tpl.tasks.map((tg) => ({
        id: tg.id,
        title: substituteVars(tg.title, vars),
        status: 'pending' as const,
        subtasks: tg.subtasks.map((st) => ({
          id: st.id,
          title: substituteVars(st.title, vars),
          status: 'pending' as const,
          subtasks: [],
        })),
      }));

      // Preview
      console.log(chalk.dim('━'.repeat(50)));
      for (const tg of tasks) {
        console.log(chalk.bold(`  ${tg.id} ${tg.title}`));
        for (const sub of tg.subtasks) {
          console.log(chalk.dim(`    ${sub.id} ${sub.title}`));
        }
      }
      console.log(chalk.dim('━'.repeat(50)));

      const totalItems = tasks.reduce((sum, t) => sum + t.subtasks.length + 1, 0);
      const confirm = await promptConfirm(`Create quick task list with ${totalItems} items?`, true);
      if (!confirm) {
        logger.info('Cancelled.');
        return;
      }

      const { id, filePath } = await createArtifact(
        projectDir,
        config,
        'quick',
        'quick/quick-task.md.hbs',
        { title, tasks },
      );

      logger.success(`Created ${id}: ${title}`);
      logger.dim(`  ${filePath}`);
      logger.dim(`  Template: ${tpl.name}`);
      logger.dim('');
      logger.dim(`  Next: planr quick implement ${id}`);
    });

  // -----------------------------------------------------------------------
  // planr template save <taskId>
  // -----------------------------------------------------------------------
  template
    .command('save')
    .description('Save an existing task list as a reusable template')
    .argument('<taskId>', 'task ID to save as template (e.g., TASK-001, QT-003)')
    .option('-n, --name <name>', 'template name (lowercase, hyphenated)')
    .action(async (taskId: string, opts) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      // Determine artifact type from ID prefix
      const prefix = taskId.split('-')[0];
      const type = prefix === 'QT' ? 'quick' : prefix === 'TASK' ? 'task' : null;
      if (!type) {
        logger.error('Only TASK-* and QT-* IDs can be saved as templates.');
        return;
      }

      const raw = await readArtifactRaw(projectDir, config, type, taskId);
      if (!raw) {
        logger.error(`${taskId} not found.`);
        return;
      }

      const templateName =
        opts.name || (await promptText('Template name (lowercase, hyphenated):'));
      const description = await promptText('Brief description:');

      // Parse tasks from the markdown
      const { parseTaskMarkdown } = await import('../../agents/task-parser.js');
      const parsed = parseTaskMarkdown(raw);

      // Convert to template format
      const taskGroups: TaskTemplate['tasks'] = [];
      let currentGroup: TaskTemplate['tasks'][number] | null = null;

      for (const item of parsed) {
        if (item.depth === 0) {
          currentGroup = { id: item.id, title: item.title, subtasks: [] };
          taskGroups.push(currentGroup);
        } else if (currentGroup) {
          currentGroup.subtasks.push({ id: item.id, title: item.title });
        }
      }

      const templateData: Omit<TaskTemplate, 'source'> = {
        name: templateName,
        description,
        variables: [],
        tasks: taskGroups,
      };

      // Save to custom templates directory
      const customDir = path.join(projectDir, config.outputPaths.agile, 'templates');
      await ensureDir(customDir);
      const filePath = path.join(customDir, `${templateName}.json`);
      await writeFile(filePath, `${JSON.stringify(templateData, null, 2)}\n`);

      logger.success(`Saved template "${templateName}"`);
      logger.dim(`  ${filePath}`);
      logger.dim(`  ${taskGroups.length} task groups, ${parsed.length} total items`);
      logger.dim('');
      logger.dim(`  Use it: planr template use ${templateName} --title "My Task"`);
    });

  // -----------------------------------------------------------------------
  // planr template delete <name>
  // -----------------------------------------------------------------------
  template
    .command('delete')
    .description('Delete a custom template')
    .argument('<name>', 'template name')
    .action(async (name: string) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      const customDir = path.join(projectDir, config.outputPaths.agile, 'templates');
      const filePath = path.join(customDir, `${name}.json`);

      if (!(await fileExists(filePath))) {
        logger.error(`Custom template "${name}" not found. Only custom templates can be deleted.`);
        return;
      }

      const confirm = await promptConfirm(`Delete template "${name}"?`, false);
      if (!confirm) {
        logger.info('Cancelled.');
        return;
      }

      const { rm } = await import('node:fs/promises');
      await rm(filePath);
      logger.success(`Deleted template "${name}"`);
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadBuiltInTemplates(): Promise<TaskTemplate[]> {
  const dir = path.join(getTemplatesDir(), 'task-templates');
  const files = await listFiles(dir, /\.json$/);
  const templates: TaskTemplate[] = [];

  for (const file of files) {
    const raw = await readFile(path.join(dir, file));
    const data = JSON.parse(raw);
    templates.push({ ...data, source: 'built-in' });
  }

  return templates;
}

async function loadCustomTemplates(
  projectDir: string,
  config: OpenPlanrConfig,
): Promise<TaskTemplate[]> {
  const dir = path.join(projectDir, config.outputPaths.agile, 'templates');
  if (!(await fileExists(dir))) return [];

  const files = await listFiles(dir, /\.json$/);
  const templates: TaskTemplate[] = [];

  for (const file of files) {
    const raw = await readFile(path.join(dir, file));
    const data = JSON.parse(raw);
    templates.push({ ...data, source: 'custom' });
  }

  return templates;
}

async function loadAllTemplates(
  projectDir: string,
  config: OpenPlanrConfig,
): Promise<TaskTemplate[]> {
  const [builtIn, custom] = await Promise.all([
    loadBuiltInTemplates(),
    loadCustomTemplates(projectDir, config),
  ]);
  return [...builtIn, ...custom];
}

async function findTemplate(
  name: string,
  projectDir: string,
  config: OpenPlanrConfig,
): Promise<TaskTemplate | null> {
  const all = await loadAllTemplates(projectDir, config);
  return all.find((t) => t.name === name) ?? null;
}

function substituteVars(text: string, vars: Record<string, string>): string {
  let result = text;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}
