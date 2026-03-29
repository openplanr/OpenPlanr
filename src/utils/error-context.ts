/**
 * Error context extraction and multi-line input utilities.
 *
 * Used by `planr task fix` to intelligently truncate verbose build/test
 * output down to the error-relevant portion before sending to an AI agent.
 */

/** Maximum lines to send to the agent from piped input */
const MAX_ERROR_LINES = 150;

/** Context lines to keep before the first error marker */
const CONTEXT_BEFORE = 20;

/** Patterns that indicate the start of an error section */
const ERROR_MARKERS: ReadonlyArray<RegExp> = [
  /^error/i,
  /^FAIL/i,
  /=> ERROR/,
  /^\s*[✗✘]/,
  /^fatal:/i,
  /^panic:/,
  /Traceback/,
  /^npm ERR!/,
  /^SyntaxError/,
  /^TypeError/,
  /^ReferenceError/,
  /Could not/i,
  /No matching/i,
  /exit code: \d+/,
  /did not complete successfully/,
];

/**
 * Extract only the error-relevant portion from verbose build output.
 *
 * - Input ≤ 150 lines → returned as-is
 * - Error marker found → keeps 20 lines of context before it + up to 130 after
 * - No marker found → keeps the last 150 lines (tail)
 */
export function extractErrorContext(raw: string): string {
  const lines = raw.split('\n');
  if (lines.length <= MAX_ERROR_LINES) return raw;

  const firstErrorIdx = lines.findIndex((line) => ERROR_MARKERS.some((re) => re.test(line)));

  if (firstErrorIdx === -1) {
    const tail = lines.slice(-MAX_ERROR_LINES);
    return `... (${lines.length - MAX_ERROR_LINES} lines trimmed)\n${tail.join('\n')}`;
  }

  const start = Math.max(0, firstErrorIdx - CONTEXT_BEFORE);
  const extracted = lines.slice(start, start + MAX_ERROR_LINES);

  const parts: string[] = [];
  if (start > 0) {
    parts.push(`... (${start} lines trimmed)`);
  }
  parts.push(extracted.join('\n'));
  if (start + MAX_ERROR_LINES < lines.length) {
    parts.push(`... (${lines.length - start - MAX_ERROR_LINES} lines trimmed)`);
  }

  return parts.join('\n');
}

/**
 * Read multi-line input from the terminal.
 *
 * The user types or pastes text and submits by pressing Enter on an
 * empty line (double Enter). Large pastes are automatically truncated
 * to the error-relevant portion.
 */
export async function readMultilineInput(): Promise<string> {
  const { createInterface } = await import('node:readline');

  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '',
    });

    const lines: string[] = [];
    let consecutiveEmpty = 0;

    rl.on('line', (line: string) => {
      if (line.trim() === '') {
        consecutiveEmpty++;
        if (consecutiveEmpty >= 2) {
          rl.close();
          return;
        }
        lines.push(line);
      } else {
        consecutiveEmpty = 0;
        lines.push(line);
      }
    });

    rl.on('close', () => {
      const raw = lines.join('\n').trim();
      resolve(raw.split('\n').length > MAX_ERROR_LINES ? extractErrorContext(raw) : raw);
    });
  });
}
