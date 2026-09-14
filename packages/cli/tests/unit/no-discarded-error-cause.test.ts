import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = path.resolve('src');

/**
 * A parameterless `catch` that then reports a different error destroys the only evidence of what
 * actually failed. A `catch` that swallows and continues is a separate judgement and is allowed.
 */
const REPORTING_CATCH = /\}\s*catch\s*\{(?:[^{}]|\{[^{}]*\})*?\bfail[A-Za-z]*\s*\(/gsu;

/**
 * Known offenders at the time this guard landed. Five sit inside the Operate runtime scheduled
 * for deletion and resolve by being deleted; the three connector files are the real remainder.
 * Nothing may be added here — the guard exists to stop the pattern spreading, not to bless it.
 */
const KNOWN_OFFENDERS = [
  // Both spellings of the operate service directory are listed: the tree is mid-rename from
  // `operate-v2/` to `operate/`, and the guard must pass on either.
  'src/services/operate-v2/delivery-evidence.ts',
  'src/services/operate-v2/spec-operating-origin-service.ts',
  'src/services/connectors/checkpoint-custody.ts',
  'src/services/connectors/connector-runtime.ts',
  'src/services/connectors/credential-custody.ts',
  'src/services/operate/delivery-evidence.ts',
  'src/services/operate/spec-operating-origin-service.ts',
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const absolute = path.join(directory, name);
    if (statSync(absolute).isDirectory()) return sourceFiles(absolute);
    return absolute.endsWith('.ts') && !absolute.endsWith('.d.ts') ? [absolute] : [];
  });
}

describe('caught errors are not discarded on the way to a different one', () => {
  it('no parameterless catch reports a replacement error', () => {
    const offenders = sourceFiles(SOURCE_ROOT)
      .filter((file) => REPORTING_CATCH.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(process.cwd(), file).split(path.sep).join('/'))
      .filter((file) => !KNOWN_OFFENDERS.includes(file))
      .sort();

    expect(offenders).toEqual([]);
  });
});
