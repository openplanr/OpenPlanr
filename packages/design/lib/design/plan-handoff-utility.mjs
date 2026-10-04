#!/usr/bin/env node
/** Read-only support for Plan's approved Design handoff; never opens or renders Studio. */
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDesignHandoff } from './handoff-reader.mjs';

export function inspectPlanDesignHandoff(
  argv,
  { stdout = (value) => process.stdout.write(`${JSON.stringify(value)}\n`) } = {},
) {
  if (argv.length === 0 || ['--help', 'help'].includes(argv[0])) {
    const help = {
      usage: 'design.mjs handoff <design-document.json> [--action inspect] [--json]',
      note: 'Reads the existing handoff and its current approval; never renders, publishes, or starts implementation.',
    };
    stdout(help);
    return help;
  }
  const [command, input, ...args] = argv;
  if (command !== 'handoff' || !input)
    throw new Error('Usage: design.mjs handoff <design-document.json> [--action inspect] [--json]');
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--json') continue;
    if (args[index] === '--action' && args[++index] === 'inspect') continue;
    throw new Error('Plan handoff support only accepts --action inspect and --json.');
  }
  const result = readDesignHandoff(resolve(input), { recoverPublication: false });
  stdout(result);
  return result;
}

export async function main(argv = process.argv.slice(2)) {
  try {
    return inspectPlanDesignHandoff(argv);
  } catch (error) {
    process.stderr.write(`${error.code ? `${error.code}: ` : ''}${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]))
  await main();
