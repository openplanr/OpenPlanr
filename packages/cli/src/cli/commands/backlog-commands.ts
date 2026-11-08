import type { Command } from 'commander';
import { listBacklog, normalizeBacklogFiles, parseWhen } from '../../../lib/backlog-item.mjs';
import { updateArtifactFields } from '../../services/artifact-service.js';
import { loadConfig } from '../../services/config-service.js';
import { display, logger } from '../../utils/logger.js';
import { requireArtifactId } from '../helpers/artifact-id.js';

export function configureBacklogCommands(program: Command, root: Command): void {
  const command = (name: string): Command => {
    const found = root.commands.find((entry) => entry.name() === name);
    if (!found) throw new Error(`Backlog command ${name} is not registered.`);
    return found;
  };
  command('add')
    .option('-p, --priority <priority>', 'critical, high, medium, or low')
    .option('-t, --tag <tags...>')
    .option('--epic <id>')
    .option(
      '--when <value>',
      'next-unit:<ref>, sprint:<id or next>, trigger:<event>, or declined:<reason>',
    )
    .option('--files <paths...>', 'repo-relative paths without line numbers');

  command('list')
    .option('--open', 'exclude closed and done items')
    .option('--files <paths...>', 'keep items overlapping any of these repo-relative paths')
    .option('--no-when', 'keep items without a scheduling decision')
    .option('--json', 'emit one machine-readable result')
    .action(
      async (options: { open?: boolean; files?: string[]; when?: boolean; json?: boolean }) => {
        const projectDir = program.opts().projectDir as string;
        await loadConfig(projectDir);
        const items = await listBacklog(projectDir, {
          open: options.open,
          files: options.files,
          noWhen: options.when === false,
        });
        if (options.json) {
          display.line(JSON.stringify({ items }));
          return;
        }
        for (const item of items) display.line(`${item.id}\t${item.title}`);
        if (items.length === 0) logger.info('No backlog artifacts found.');
      },
    );

  command('update')
    .option(
      '--when <value>',
      'next-unit:<ref>, sprint:<id or next>, trigger:<event>, or declined:<reason>',
    )
    .option('--files <paths...>', 'replace the repo-relative paths without line numbers')
    .action(async (id: string, options: Record<string, unknown>) => {
      requireArtifactId(id, 'id', 'BL-001');
      const fields = Object.fromEntries(
        Object.entries(options).filter(([, value]) => value !== undefined),
      );
      if (Object.keys(fields).length === 0)
        throw new Error('Provide --status, --owner, --title, --when, or --files.');
      if (options.when !== undefined) parseWhen(options.when);
      if (options.files !== undefined) fields.files = normalizeBacklogFiles(options.files);
      const projectDir = program.opts().projectDir as string;
      await updateArtifactFields(projectDir, await loadConfig(projectDir), 'backlog', id, fields);
      logger.success(`Updated ${id}.`);
    });
}
