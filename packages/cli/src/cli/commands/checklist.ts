import chalk from 'chalk';
import type { Command } from 'commander';
import {
  createChecklist,
  getChecklistPath,
  getChecklistProgress,
  parseChecklistItems,
  readChecklist,
  resetChecklist,
  toggleChecklistItems,
} from '../../services/checklist-service.js';
import { loadConfig } from '../../services/config-service.js';
import { promptCheckbox } from '../../services/prompt-service.js';
import { writeFile } from '../../utils/fs.js';
import { display, logger } from '../../utils/logger.js';

export function registerChecklistCommand(program: Command) {
  const checklist = program
    .command('checklist')
    .description('Manage the agile development checklist');

  checklist
    .command('show')
    .description('Display the agile development checklist')
    .action(async () => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      let content = await readChecklist(projectDir, config);
      if (!content) {
        logger.info('No checklist found. Creating one...');
        await createChecklist(projectDir, config);
        content = await readChecklist(projectDir, config);
      }

      if (content) {
        display.line(content);

        const items = parseChecklistItems(content);
        if (items.length > 0) {
          const { done, total, percent } = getChecklistProgress(items);
          const color = percent >= 75 ? chalk.green : percent >= 25 ? chalk.yellow : chalk.red;
          display.line(color(`\nProgress: ${done}/${total} complete (${percent}%)`));
        }
      }
    });

  checklist
    .command('toggle [items...]')
    .description('Toggle checklist items (e.g., `planr checklist toggle 1 3 5` or interactive)')
    .action(async (itemArgs: string[]) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      let content = await readChecklist(projectDir, config);
      if (!content) {
        logger.info('No checklist found. Creating one...');
        await createChecklist(projectDir, config);
        content = await readChecklist(projectDir, config);
      }

      if (!content) {
        logger.error('Could not read checklist.');
        return;
      }

      const items = parseChecklistItems(content);
      if (items.length === 0) {
        logger.info('No checklist items found.');
        return;
      }

      let toToggle: Set<number>;

      if (itemArgs.length > 0) {
        // Direct toggle: planr checklist toggle 1 3 5
        const validIndices = new Set(items.map((i) => i.index));
        const parsed = itemArgs.map(Number).filter((n) => !Number.isNaN(n));
        const invalid = parsed.filter((n) => !validIndices.has(n));
        toToggle = new Set(parsed.filter((n) => validIndices.has(n)));
        if (invalid.length > 0) {
          logger.warn(`Ignored invalid item(s): ${invalid.join(', ')}`);
        }
        if (toToggle.size === 0) {
          logger.error('No valid item numbers. Use: planr checklist toggle 1 3 5');
          return;
        }
      } else {
        // Interactive mode
        const choices = items.map((item) => ({
          name: `${item.index}. ${item.activity}`,
          value: String(item.index),
          checked: item.done,
        }));

        const selected = await promptCheckbox(
          'Toggle checklist items (space to toggle, enter to confirm):',
          choices,
        );
        const selectedSet = new Set(selected.map(Number));

        toToggle = new Set<number>();
        for (const item of items) {
          const wasChecked = item.done;
          const nowChecked = selectedSet.has(item.index);
          if (wasChecked !== nowChecked) {
            toToggle.add(item.index);
          }
        }
      }

      if (toToggle.size === 0) {
        logger.info('No changes made.');
        return;
      }

      const updated = toggleChecklistItems(content, toToggle, items);
      const filePath = getChecklistPath(projectDir, config);
      await writeFile(filePath, updated);

      const updatedItems = parseChecklistItems(updated);
      const { done, total, percent } = getChecklistProgress(updatedItems);
      const color = percent >= 75 ? chalk.green : percent >= 25 ? chalk.yellow : chalk.red;

      logger.success(`Updated ${toToggle.size} item(s).`);
      display.line(color(`Progress: ${done}/${total} complete (${percent}%)`));
    });

  checklist
    .command('reset')
    .description('Reset the checklist to its initial state')
    .action(async () => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);
      await resetChecklist(projectDir, config);
      logger.success('Checklist has been reset.');
    });
}
