/**
 * `openplanr template` command group.
 *
 * Reusable task patterns for common development tasks.
 * Ships with 5 built-in templates and supports custom templates
 * saved from existing task lists.
 */

import { realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import type { OpenPlanrConfig } from '../../models/types.js';
import { createArtifact, readArtifactRaw } from '../../services/artifact-service.js';
import { atomicWriteFile } from '../../services/atomic-write-service.js';
import { loadConfig } from '../../services/config-service.js';
import { promptConfirm, promptText } from '../../services/prompt-service.js';
import { CLI_COMMAND, getTemplatesDir } from '../../utils/constants.js';
import { ensureDir, fileExists, listFiles, readFile } from '../../utils/fs.js';
import { display, logger } from '../../utils/logger.js';
import { CliBoundaryError } from '../error-boundary.js';
import { requireArtifactId } from '../helpers/artifact-id.js';

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
  // openplanr template list
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
      display.blank();

      const builtIn = templates.filter((t) => t.source === 'built-in');
      const custom = templates.filter((t) => t.source === 'custom');

      if (builtIn.length > 0) {
        display.heading('  Built-in:');
        for (const t of builtIn) {
          const taskCount = t.tasks.reduce((sum, tg) => sum + tg.subtasks.length + 1, 0);
          display.line(
            `    ${chalk.cyan(t.name)}  ${chalk.dim(`— ${t.description} (${taskCount} tasks)`)}`,
          );
        }
      }

      if (custom.length > 0) {
        display.blank();
        display.heading('  Custom:');
        for (const t of custom) {
          const taskCount = t.tasks.reduce((sum, tg) => sum + tg.subtasks.length + 1, 0);
          display.line(
            `    ${chalk.green(t.name)}  ${chalk.dim(`— ${t.description} (${taskCount} tasks)`)}`,
          );
        }
      }

      display.blank();
      logger.dim(`Use: ${CLI_COMMAND} template use <name> --title "My Task"`);
    });

  // -----------------------------------------------------------------------
  // openplanr template show <name>
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
          `Template "${name}" not found. Run \`${CLI_COMMAND} template list\` to see available templates.`,
        );
        return;
      }

      logger.heading(`Template: ${tpl.name}`);
      display.line(chalk.dim(`  ${tpl.description}`));
      if (tpl.variables.length > 0) {
        display.line(chalk.dim(`  Variables: ${tpl.variables.join(', ')}`));
      }
      display.blank();

      for (const taskGroup of tpl.tasks) {
        display.heading(`  ${taskGroup.id} ${taskGroup.title}`);
        for (const sub of taskGroup.subtasks) {
          display.line(chalk.dim(`    ${sub.id} ${sub.title}`));
        }
      }
      display.blank();
    });

  // -----------------------------------------------------------------------
  // openplanr template use <name>
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
      display.separator(50);
      for (const tg of tasks) {
        display.heading(`  ${tg.id} ${tg.title}`);
        for (const sub of tg.subtasks) {
          display.line(chalk.dim(`    ${sub.id} ${sub.title}`));
        }
      }
      display.separator(50);

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
      logger.dim(`  Next: Open ${id} in your coding agent for implementation`);
    });

  // -----------------------------------------------------------------------
  // openplanr template save <taskId>
  // -----------------------------------------------------------------------
  template
    .command('save')
    .description('Save an existing task list as a reusable template')
    .argument('<taskId>', 'task ID to save as template (e.g., TASK-001, QT-003)')
    .option('-n, --name <name>', 'template name (lowercase, hyphenated)')
    .action(async (taskId: string, opts) => {
      requireArtifactId(taskId, 'taskId', 'TASK-001');
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

      const templateName = requireTemplateName(
        opts.name || (await promptText('Template name (lowercase, hyphenated):')),
      );
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
      await atomicWriteFile(
        await customTemplateFile(projectDir, config, templateName),
        `${JSON.stringify(templateData, null, 2)}\n`,
      );

      logger.success(`Saved template "${templateName}"`);
      logger.dim(`  ${filePath}`);
      logger.dim(`  ${taskGroups.length} task groups, ${parsed.length} total items`);
      logger.dim('');
      logger.dim(`  Use it: ${CLI_COMMAND} template use ${templateName} --title "My Task"`);
    });

  // -----------------------------------------------------------------------
  // openplanr template delete <name>
  // -----------------------------------------------------------------------
  template
    .command('delete')
    .description('Delete a custom template')
    .argument('<name>', 'template name')
    .action(async (name: string) => {
      requireTemplateName(name);
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      const customDir = path.join(projectDir, config.outputPaths.agile, 'templates');
      const filePath = (await fileExists(customDir))
        ? await customTemplateFile(projectDir, config, name)
        : undefined;

      if (!filePath || !(await fileExists(filePath))) {
        logger.error(`Custom template "${name}" not found. Only custom templates can be deleted.`);
        return;
      }

      const confirm = await promptConfirm(`Delete template "${name}"?`, false);
      if (!confirm) {
        logger.info('Cancelled.');
        return;
      }

      await rm(filePath);
      logger.success(`Deleted template "${name}"`);
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Lowercase words joined by single hyphens, like the built-in templates: never a path. */
const TEMPLATE_NAME = /^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function requireTemplateName(name: string): string {
  if (TEMPLATE_NAME.test(name)) return name;
  throw new CliBoundaryError(
    'E_TEMPLATE_NAME_INVALID',
    `A template name must be lowercase words joined by hyphens, such as rest-endpoint, in at most 64 characters; received ${JSON.stringify(name)}.`,
  );
}

/**
 * The file of custom template `name` in the templates directory of the planning root.
 * Refuses a templates directory that resolves anywhere but directly inside the real planning
 * root, so no write or delete follows a link out of it.
 */
async function customTemplateFile(
  projectDir: string,
  config: OpenPlanrConfig,
  name: string,
): Promise<string> {
  const planningRoot = path.join(projectDir, config.outputPaths.agile);
  const realRoot = await realpath(planningRoot);
  const directory = await realpath(path.join(planningRoot, 'templates'));
  const file = path.join(directory, `${requireTemplateName(name)}.json`);
  if (path.dirname(directory) !== realRoot || path.dirname(file) !== directory) {
    throw new CliBoundaryError(
      'E_TEMPLATE_DIR_OUTSIDE',
      'The templates directory resolves outside the planning directory, so no template is written or deleted through it.',
      {
        recovery:
          'Replace the linked templates directory with a real directory in the planning directory.',
      },
    );
  }
  return file;
}

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
