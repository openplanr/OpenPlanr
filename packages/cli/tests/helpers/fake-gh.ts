import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CALL_LOG = 'gh-calls.log';
const ENV_LOG = 'gh-env.log';

/** Write a `gh` stand-in into `bin`; it answers a command by the first prefix it starts with and logs each call. A `{ stderr }` response fails with that text. */
export function fakeGh(bin: string, responses: Record<string, string | { stderr: string }>): void {
  const script = join(bin, 'gh');
  writeFileSync(
    script,
    `#!${process.execPath}
const responses = ${JSON.stringify(responses)};
const command = process.argv.slice(2).join(' ');
require('node:fs').appendFileSync(${JSON.stringify(join(bin, CALL_LOG))}, command + '\\n');
require('node:fs').appendFileSync(${JSON.stringify(join(bin, ENV_LOG))}, JSON.stringify(Object.keys(process.env).sort()) + '\\n');
const key = Object.keys(responses).find((prefix) => command.startsWith(prefix));
if (key === undefined) {
  process.stderr.write('unexpected gh ' + command);
  process.exit(1);
}
const response = responses[key];
if (typeof response !== 'string') {
  process.stderr.write(response.stderr);
  process.exit(1);
}
process.stdout.write(response);
`,
  );
  chmodSync(script, 0o755);
}

/** Commands the stand-in in `bin` received, oldest first. */
export function fakeGhCalls(bin: string): string[] {
  const log = join(bin, CALL_LOG);
  return existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
}

/** Environment variable names each call to the stand-in in `bin` received, oldest first. */
export function fakeGhEnvironments(bin: string): string[][] {
  const log = join(bin, ENV_LOG);
  return existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[])
    : [];
}
