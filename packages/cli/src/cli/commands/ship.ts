import chalk from 'chalk';
import type { Command } from 'commander';
import type { ShipChecksResult, ShipTier } from '../../services/ship-checks/contract.js';
import { SHIP_TIERS } from '../../services/ship-checks/contract.js';
import { discoverShipChecks } from '../../services/ship-checks/discover.js';
import { display } from '../../utils/logger.js';
import { CliBoundaryError, toCliFailureEnvelope } from '../error-boundary.js';

type ChecksOptions = { task?: string; tier?: string; base?: string; json?: boolean };

function parseTier(value: string | undefined): ShipTier | undefined {
  if (value === undefined) return undefined;
  if ((SHIP_TIERS as readonly string[]).includes(value)) return value as ShipTier;
  throw new CliBoundaryError('E_SHIP_CHECKS_TIER_INVALID', `Unknown tier "${value}".`, {
    recovery: `Use one of: ${SHIP_TIERS.join(', ')}.`,
  });
}

function render(result: ShipChecksResult): void {
  display.heading(`Ship checks: ${result.tier} tier (${result.tierSource})`);
  for (const check of result.checks) {
    const [first, ...rest] = check.command.split('\n');
    const more = rest.length > 0 ? chalk.dim(` (+${rest.length} lines)`) : '';
    const where = check.cwd === '.' ? '' : chalk.dim(` [${check.cwd}]`);
    display.line(`  ${first}${more}${where}  ${chalk.dim(check.tags.join(', '))}`);
  }
  for (const requirement of result.requirements)
    display.line(`  ${chalk.dim('requirement:')} ${requirement.text}`);
  for (const entry of result.diagnostics)
    display.line(`  ${chalk.dim(entry.severity)} ${entry.code}: ${entry.message}`);
  if (!result.complete)
    display.line(
      chalk.yellow('  Incomplete: an error diagnostic means the check set may miss CI steps.'),
    );
}

export function registerShipCommand(program: Command): void {
  const ship = program
    .command('ship')
    .description('Deterministic helpers for implementing and shipping work');
  ship
    .command('checks')
    .description(
      'List the checks a change needs for a tier, read from CI, hooks and the task, without running them',
    )
    .option('--task <path>', 'task file whose Test Requirements to include')
    .option(
      '--tier <tier>',
      `check tier: ${SHIP_TIERS.join(', ')} (default: planning for a .planr-only change, else task)`,
    )
    .option(
      '--base <ref>',
      'compare against the merge base with this ref (default: origin/HEAD, then main)',
    )
    .option('--json', 'machine-readable output', false)
    .action(async (options: ChecksOptions) => {
      const json = Boolean(options.json);
      try {
        const result = await discoverShipChecks({
          projectDir: program.opts().projectDir as string,
          task: options.task,
          tier: parseTier(options.tier),
          base: options.base,
        });
        if (json) display.line(JSON.stringify(result, null, 2));
        else render(result);
      } catch (error) {
        const failure = toCliFailureEnvelope(error, { code: 'E_SHIP_CHECKS_FAILED' });
        if (json) display.line(JSON.stringify(failure, null, 2));
        else
          display.line(
            `${failure.code}: ${failure.problem}${failure.recovery ? `\n${failure.recovery}` : ''}`,
          );
        process.exitCode = 1;
      }
    });
}
