import chalk from 'chalk';
// ---------------------------------------------------------------------------
// Internal output primitives — the only place console.* is allowed.
// All public APIs (logger.*, display.*) delegate here.
// ---------------------------------------------------------------------------
// biome-ignore lint/suspicious/noConsole: logger is the intentional console abstraction
const out = (...args) => console.log(...args);
// biome-ignore lint/suspicious/noConsole: logger is the intentional console abstraction
const outErr = (...args) => console.error(...args);
let verboseEnabled = false;
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
/** Format token usage for display. Returns empty string if no usage data. */
export function formatUsage(usage) {
    if (!usage)
        return '';
    return ` (${usage.inputTokens.toLocaleString()} in → ${usage.outputTokens.toLocaleString()} out tokens)`;
}
export function createSpinner(message) {
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
        update(msg) {
            currentMsg = msg;
        },
        stop() {
            clearInterval(interval);
            process.stdout.write(`\r${' '.repeat(currentMsg.length + 4)}\r`);
        },
        succeed(msg) {
            clearInterval(interval);
            process.stdout.write(`\r${' '.repeat(currentMsg.length + 4)}\r`);
            out(chalk.green('✓'), msg);
        },
    };
}
export function setVerbose(enabled) {
    verboseEnabled = enabled;
}
export function isVerbose() {
    return verboseEnabled;
}
export const logger = {
    info(msg) {
        out(chalk.blue('ℹ'), msg);
    },
    success(msg) {
        out(chalk.green('✓'), msg);
    },
    warn(msg) {
        out(chalk.yellow('⚠'), msg);
    },
    error(msg) {
        outErr(chalk.red('✗'), msg);
    },
    heading(msg) {
        out(chalk.bold.cyan(`\n${msg}`));
    },
    dim(msg) {
        out(chalk.dim(msg));
    },
    debug(msg, ...args) {
        if (verboseEnabled) {
            const extra = args.length > 0
                ? ` ${args.map((a) => (a instanceof Error ? (a.stack ?? a.message) : String(a))).join(' ')}`
                : '';
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
    line(text) {
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
    heading(text) {
        out(chalk.bold(text));
    },
    /** Print a key-value pair with aligned label. */
    keyValue(label, value, indent = 2) {
        const pad = ' '.repeat(indent);
        out(`${pad}${chalk.dim(`${label}:`)}  ${value}`);
    },
    /** Print a bulleted list item. */
    bullet(text, indent = 4) {
        const pad = ' '.repeat(indent);
        out(`${pad}• ${text}`);
    },
    /** Print a numbered list item. */
    numbered(index, text, indent = 4) {
        const pad = ' '.repeat(indent);
        out(`${pad}${chalk.dim(`${index}.`)} ${text}`);
    },
    /** Print a table header row with dim column names. */
    tableHeader(columns, indent = 2) {
        const pad = ' '.repeat(indent);
        const header = columns.map((c) => chalk.dim(c.label.padEnd(c.width))).join(' ');
        out(`${pad}${header}`);
    },
    /** Print a table row with padded columns. */
    tableRow(values, widths, indent = 2) {
        const pad = ' '.repeat(indent);
        const row = values.map((v, i) => v.padEnd(widths[i] ?? 0)).join(' ');
        out(`${pad}${row}`);
    },
    /** Print a table separator matching column widths. */
    tableSeparator(totalWidth, indent = 2, char = '─') {
        const pad = ' '.repeat(indent);
        out(`${pad}${char.repeat(totalWidth)}`);
    },
    /** Print a progress bar. */
    progressBar(percent, width = 20, opts = {}) {
        const { label = '', indent = 2 } = opts;
        const pad = ' '.repeat(indent);
        const clamped = Math.max(0, Math.min(100, percent));
        const safeWidth = Math.max(1, width);
        const filled = Math.round((clamped / 100) * safeWidth);
        const empty = safeWidth - filled;
        const bar = `${chalk.green('█'.repeat(filled))}${chalk.dim('░'.repeat(empty))}`;
        const pctStr = clamped >= 75
            ? chalk.green(`${clamped}%`)
            : clamped >= 25
                ? chalk.yellow(`${clamped}%`)
                : chalk.red(`${clamped}%`);
        out(`${pad}${bar} ${pctStr}${label ? `  ${label}` : ''}`);
    },
};
//# sourceMappingURL=logger.js.map