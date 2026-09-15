/**
 * `planr report-linter` — validate stakeholder markdown before sending.
 */

import { readFile } from 'node:fs/promises';
import type { Command } from 'commander';
import type { StakeholderReportType } from '../../models/types.js';
import { loadConfig } from '../../services/config-service.js';
import { lintWithProjectConfig } from '../../services/report-linter-service.js';
import { display, logger } from '../../utils/logger.js';

function parseReportType(raw: string | undefined): StakeholderReportType {
  const s = (raw ?? 'weekly').toLowerCase().trim();
  const map: Record<string, StakeholderReportType> = {
    sprint: 'sprint',
    weekly: 'weekly',
    executive: 'executive',
    standup: 'standup',
    retro: 'retro',
    retrospective: 'retro',
    release: 'release',
    'release-notes': 'release',
  };
  return map[s] ?? 'weekly';
}

export function registerReportLinterCommand(program: Command) {
  program
    .command('report-linter [file]')
    .description('Lint a stakeholder report markdown file')
    .option('--type <t>', 'report type for rule selection', 'weekly')
    .action(async (file: string | undefined, opts: { type: string }) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);
      const reportType = parseReportType(opts.type);

      let markdown: string;
      if (file) {
        markdown = await readFile(file, 'utf-8');
      } else {
        const chunks: Buffer[] = [];
        for await (const c of process.stdin) chunks.push(c as Buffer);
        markdown = Buffer.concat(chunks).toString('utf-8');
        if (!markdown.trim()) {
          logger.error('Provide a [file] path or pipe markdown on stdin.');
          process.exit(1);
        }
      }

      const lint = lintWithProjectConfig(markdown, reportType, config);
      for (const f of lint.findings) {
        display.line(`[${f.severity}] ${f.ruleId}: ${f.message}`);
        if (f.suggestion) display.line(`  suggestion: ${f.suggestion}`);
      }
      for (const c of lint.coaching) {
        display.line(`(coaching) ${c.message}`);
        if (c.educational) display.line(`  ${c.educational}`);
      }

      if (!lint.ok) process.exit(1);
      logger.success('Lint passed (no error-severity findings).');
    });
}
