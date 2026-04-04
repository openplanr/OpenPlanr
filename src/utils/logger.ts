import chalk from 'chalk';
import type { AIUsage } from '../ai/types.js';

// ---------------------------------------------------------------------------
// Internal output primitives — the only place console.* is allowed.
// All public APIs (logger.*, display.*) delegate here.
// ---------------------------------------------------------------------------
// biome-ignore lint/suspicious/noConsole: logger is the intentional console abstraction
const out = (...args: unknown[]) => console.log(...args);
// biome-ignore lint/suspicious/noConsole: logger is the intentional console abstraction
const outErr = (...args: unknown[]) => console.error(...args);

let verboseEnabled = false;

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export interface Spinner {
  update(msg: string): void;
  stop(): void;
  succeed(msg: string): void;
}

/** Format token usage for display. Returns empty string if no usage data. */
export function formatUsage(usage?: AIUsage | null): string {
  if (!usage) return '';
  return ` (${usage.inputTokens.toLocaleString()} in → ${usage.outputTokens.toLocaleString()} out tokens)`;
}

export function createSpinner(message: string): Spinner {
  let frameIndex = 0;
  let currentMsg = message;

  const write = () => {
    const frame = chalk.cyan(SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length]);
    process.stdout.write(`\r${frame} ${currentMsg}`);
    frameIndex++;
  };

  write();
  const interval = setInterval(write, 80);

  return {
    update(msg: string) {
      currentMsg = msg;
    },
    stop() {
      clearInterval(interval);
      process.stdout.write(`\r${' '.repeat(currentMsg.length + 4)}\r`);
    },
    succeed(msg: string) {
      clearInterval(interval);
      process.stdout.write(`\r${' '.repeat(currentMsg.length + 4)}\r`);
      out(chalk.green('✓'), msg);
    },
  };
}

export function setVerbose(enabled: boolean): void {
  verboseEnabled = enabled;
}

export function isVerbose(): boolean {
  return verboseEnabled;
}

export const logger = {
  info(msg: string) {
    out(chalk.blue('ℹ'), msg);
  },
  success(msg: string) {
    out(chalk.green('✓'), msg);
  },
  warn(msg: string) {
    out(chalk.yellow('⚠'), msg);
  },
  error(msg: string) {
    outErr(chalk.red('✗'), msg);
  },
  heading(msg: string) {
    out(chalk.bold.cyan(`\n${msg}`));
  },
  dim(msg: string) {
    out(chalk.dim(msg));
  },
  debug(msg: string, ...args: unknown[]) {
    if (verboseEnabled) {
      const extra = args.length > 0 ? ` ${args.map(String).join(' ')}` : '';
      out(chalk.gray(`[DEBUG] ${msg}${extra}`));
    }
  },
};

// ---------------------------------------------------------------------------
// display — intentional user-facing output
//
// Use `display.*` for formatted output the user sees (tables, lists, previews).
// Use `logger.*` for operational messages (info, warn, error, debug).
// ---------------------------------------------------------------------------
export const display = {
  /** Print a single formatted line. */
  line(text: string) {
    out(text);
  },
  /** Print an empty line for spacing. */
  blank() {
    out('');
  },
  /** Print a dim horizontal separator. */
  separator(width = 50, char = '━') {
    out(chalk.dim(char.repeat(width)));
  },
  /** Print a bold section heading. */
  heading(text: string) {
    out(chalk.bold(text));
  },
  /** Print a key-value pair with aligned label. */
  keyValue(label: string, value: string, indent = 2) {
    const pad = ' '.repeat(indent);
    out(`${pad}${chalk.dim(`${label}:`)}  ${value}`);
  },
  /** Print a bulleted list item. */
  bullet(text: string, indent = 4) {
    const pad = ' '.repeat(indent);
    out(`${pad}• ${text}`);
  },
  /** Print a numbered list item. */
  numbered(index: number, text: string, indent = 4) {
    const pad = ' '.repeat(indent);
    out(`${pad}${chalk.dim(`${index}.`)} ${text}`);
  },
  /** Print a table header row with dim column names. */
  tableHeader(columns: { label: string; width: number }[], indent = 2) {
    const pad = ' '.repeat(indent);
    const header = columns.map((c) => chalk.dim(c.label.padEnd(c.width))).join(' ');
    out(`${pad}${header}`);
  },
  /** Print a table row with padded columns. */
  tableRow(values: string[], widths: number[], indent = 2) {
    const pad = ' '.repeat(indent);
    const row = values.map((v, i) => v.padEnd(widths[i] ?? 0)).join(' ');
    out(`${pad}${row}`);
  },
  /** Print a table separator matching column widths. */
  tableSeparator(totalWidth: number, indent = 2, char = '─') {
    const pad = ' '.repeat(indent);
    out(`${pad}${char.repeat(totalWidth)}`);
  },
  /** Print a progress bar. */
  progressBar(percent: number, width = 20, opts: { label?: string; indent?: number } = {}) {
    const { label = '', indent = 2 } = opts;
    const pad = ' '.repeat(indent);
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    const bar = `${chalk.green('█'.repeat(filled))}${chalk.dim('░'.repeat(empty))}`;
    const pctStr =
      percent >= 75
        ? chalk.green(`${percent}%`)
        : percent >= 25
          ? chalk.yellow(`${percent}%`)
          : chalk.red(`${percent}%`);
    out(`${pad}${bar} ${pctStr}${label ? `  ${label}` : ''}`);
  },
};
