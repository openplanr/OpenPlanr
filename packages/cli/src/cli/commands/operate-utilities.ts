import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Command } from 'commander';
import { display, logger } from '../../utils/logger.js';

export function registerOperateCommand(program: Command): void {
  const operate = program
    .command('operate')
    .description('Inspect and validate local Operate artifacts');

  operate
    .command('inspect')
    .argument('[path]', 'Operate file or directory', '.planr/operate')
    .action(async (target: string) => {
      const resolved = path.resolve(program.opts().projectDir as string, target);
      const metadata = await stat(resolved);
      display.line(
        JSON.stringify(
          {
            path: resolved,
            type: metadata.isDirectory() ? 'directory' : 'file',
            bytes: metadata.size,
          },
          null,
          2,
        ),
      );
    });

  operate
    .command('show')
    .argument('<path>', 'local Operate JSON or Markdown file')
    .action(async (target: string) => {
      const resolved = path.resolve(program.opts().projectDir as string, target);
      display.line(await readFile(resolved, 'utf8'));
    });

  operate
    .command('validate')
    .argument('<path>', 'JSON artifact to validate')
    .requiredOption('--kind <kind>', 'Protocol artifact kind')
    .option('--protocol <version>', 'Protocol version', '1.8.0')
    .option('--json', 'emit one machine-readable result')
    .action(async (target: string, options: { kind: string; protocol: string }) => {
      const { validateProtocolArtifact } = await import('planr-pipeline/protocol');
      const resolved = path.resolve(program.opts().projectDir as string, target);
      const value: unknown = JSON.parse(await readFile(resolved, 'utf8'));
      const errors = validateProtocolArtifact(options.kind, value, {
        protocolVersion: options.protocol,
      });
      if (errors.length > 0)
        throw Object.assign(new Error(`${errors.length} validation error(s).`), {
          code: 'E_OPERATE_INVALID',
          details: errors,
        });
      logger.success(`${target} satisfies ${options.kind} at Protocol ${options.protocol}.`);
    });
}
