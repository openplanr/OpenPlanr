/**
 * `planr report` — stakeholder reports from `.planr/` + optional GitHub signals.
 */

import path from 'node:path';
import type { Command } from 'commander';
import type { StakeholderReportFormat, StakeholderReportType } from '../../models/types.js';
import { loadConfig } from '../../services/config-service.js';
import { pushReportAsGitHubIssue, pushReportToSlack } from '../../services/distribution-service.js';
import {
  validateClaimsHaveAnchors,
  validateRemoteEvidence,
} from '../../services/evidence-service.js';
import { lintWithProjectConfig } from '../../services/report-linter-service.js';
import { generateStakeholderReport, writeReportOutputs } from '../../services/report-service.js';
import { display, logger } from '../../utils/logger.js';

function parseReportType(raw: string): StakeholderReportType | null {
  const s = raw.toLowerCase().trim();
  const map: Record<string, StakeholderReportType> = {
    sprint: 'sprint',
    weekly: 'weekly',
    executive: 'executive',
    standup: 'standup',
    retro: 'retro',
    retrospective: 'retro',
    release: 'release',
    'release-notes': 'release',
    releasenotes: 'release',
  };
  return map[s] ?? null;
}

export function registerReportCommand(program: Command) {
  program
    .command('report <type>')
    .description(
      'Generate stakeholder report (sprint, weekly, executive, standup, retro, release) from planr + GitHub',
    )
    .option('--sprint <id>', 'sprint id, e.g. SPRINT-001')
    .option('--days <n>', 'GitHub lookback days', '7')
    .option('--no-github', 'skip GitHub commit/PR signals')
    .option('--format <fmt>', 'markdown | html', 'markdown')
    .option('--output <dir>', 'directory under project (default: .planr/reports)')
    .option('--stdout', 'print markdown to stdout instead of writing file')
    .option('--lint', 'run report linter on generated markdown')
    .option(
      '--strict-evidence',
      'fail if bullet claims under ## headings lack URLs or #issue references',
      false,
    )
    .option('--push <targets>', 'comma-separated destinations: github, slack')
    .option('--dry-run', 'with --push: show actions only', false)
    .action(
      async (
        typeArg: string,
        opts: {
          sprint?: string;
          days: string;
          github: boolean;
          format: string;
          output?: string;
          stdout?: boolean;
          lint?: boolean;
          strictEvidence: boolean;
          push?: string;
          dryRun: boolean;
        },
      ) => {
        const projectDir = program.opts().projectDir as string;
        const config = await loadConfig(projectDir);
        const reportType = parseReportType(typeArg);
        if (!reportType) {
          logger.error(
            `Unknown report type "${typeArg}". Use: sprint, weekly, executive, standup, retro, release`,
          );
          process.exit(1);
        }

        const days = Math.max(1, Number.parseInt(opts.days, 10) || 7);
        const includeGitHub = opts.github !== false;
        const fmtRaw = opts.format.toLowerCase();
        if (fmtRaw === 'pdf') {
          logger.error('PDF format is not available in this build. Use markdown or html.');
          process.exit(1);
        }
        if (fmtRaw !== 'markdown' && fmtRaw !== 'html') {
          logger.error('Use --format markdown or html.');
          process.exit(1);
        }
        const fmt = fmtRaw as StakeholderReportFormat;

        logger.heading(`Report: ${reportType}`);

        const { markdown, html, context } = await generateStakeholderReport(projectDir, config, {
          reportType,
          days,
          sprintId: opts.sprint,
          includeGitHub,
          format: fmt,
        });

        const remote = await validateRemoteEvidence(context.evidence);
        if (!remote.repoOk && includeGitHub) {
          logger.warn(`GitHub evidence check: ${remote.repoMessage}`);
        }

        if (opts.strictEvidence) {
          const claims = validateClaimsHaveAnchors(markdown, 1);
          const bad = claims.filter((c) => !c.ok);
          if (bad.length > 0) {
            for (const c of bad) {
              logger.error(`${c.claimId}: ${c.missingReason}`);
            }
            process.exit(1);
          }
        }

        if (opts.lint) {
          const lint = lintWithProjectConfig(markdown, reportType, config);
          for (const f of lint.findings) {
            const prefix = f.severity === 'error' ? 'x' : f.severity === 'warning' ? '!' : '-';
            display.line(`  ${prefix} [${f.ruleId}] ${f.message}`);
            if (f.suggestion) display.line(` → ${f.suggestion}`);
          }
          for (const c of lint.coaching) {
            if (c.educational) display.line(`  i ${c.educational}`);
          }
          if (!lint.ok) {
            logger.warn('Linter reported errors — review before sending.');
          } else {
            logger.success('Linter: no blocking errors.');
          }
        }

        if (opts.stdout) {
          display.line(markdown);
          return;
        }

        const { mdPath, htmlPath } = await writeReportOutputs({
          projectDir,
          config,
          baseName: `${reportType}-report`,
          markdown,
          html,
          outputDir: opts.output,
        });
        if (mdPath) logger.success(`Wrote ${path.relative(projectDir, mdPath)}`);
        if (htmlPath) logger.success(`Wrote ${path.relative(projectDir, htmlPath)}`);

        if (opts.push) {
          const targets = opts.push
            .split(/,\s*/)
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean);
          for (const t of targets) {
            if (t === 'github') {
              const title = `[planr report] ${config.projectName} — ${reportType} (${new Date().toISOString().split('T')[0]})`;
              const res = await pushReportAsGitHubIssue({
                title,
                body: markdown,
                dryRun: opts.dryRun,
              });
              if (res.ok) logger.success(res.message + (res.url ? ` ${res.url}` : ''));
              else logger.error(res.message);
            } else if (t === 'slack') {
              const res = await pushReportToSlack(config, markdown, { dryRun: opts.dryRun });
              if (res.ok) logger.success(res.message);
              else logger.error(res.message);
            } else {
              logger.error(`Unknown --push target "${t}". Use: github, slack`);
              process.exit(1);
            }
          }
        }
      },
    );
}
