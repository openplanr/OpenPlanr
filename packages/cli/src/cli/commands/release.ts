import type { Command } from 'commander';
import {
  collectReleaseChanges,
  type ReleaseCollection,
} from '../../services/release-collect-service.js';
import { display } from '../../utils/logger.js';

type CollectOptions = { base?: string; head?: string; since?: string; json?: boolean };

function render(result: ReleaseCollection): void {
  const from = result.base
    ? `${result.base.revision} (${result.base.sha.slice(0, 12)})`
    : result.since
      ? `since ${result.since}`
      : 'the first commit';
  display.heading(
    `Release window: ${from} .. ${result.head.revision} (${result.head.sha.slice(0, 12)})`,
  );
  display.line(`  Recent tags: ${result.tags.length > 0 ? result.tags.join(', ') : 'none'}`);
  display.line(`  Commits: ${result.commits.length}`);
  for (const commit of result.commits) {
    const flags = [
      commit.breaking ? 'BREAKING' : '',
      commit.reverts ? `reverts ${commit.reverts.slice(0, 12)}` : '',
    ].filter(Boolean);
    display.line(
      `  ${commit.shortSha} ${commit.subject}${flags.length > 0 ? `  [${flags.join(', ')}]` : ''}`,
    );
    for (const note of commit.breakingNotes) display.line(`      BREAKING CHANGE: ${note}`);
  }
  if (result.areas.length > 0) {
    display.line('  Areas:');
    for (const { area, count } of result.areas) display.line(`    ${count}  ${area}`);
  }
}

export function registerReleaseCommand(program: Command): void {
  const release = program
    .command('release')
    .description('Deterministic helpers for preparing a release');
  release
    .command('collect')
    .description(
      'Collect commits with bodies, footers, reverts and touched areas between two revisions, without writing',
    )
    .option(
      '--base <revision>',
      'start of the window, exclusive (default: last tag reachable from head)',
    )
    .option('--head <revision>', 'end of the window, inclusive (default: HEAD)')
    .option('--since <date>', 'start the window at a date (YYYY-MM-DD) instead of a revision')
    .option('--json', 'machine-readable output', false)
    .action(async (options: CollectOptions) => {
      const result = await collectReleaseChanges({
        projectDir: program.opts().projectDir as string,
        base: options.base,
        head: options.head,
        since: options.since,
      });
      if (options.json) display.line(JSON.stringify({ ok: true, ...result }));
      else render(result);
    });
}
