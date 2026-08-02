/**
 * Shared formatting utilities for CLI output.
 */
import chalk from 'chalk';
/**
 * Colors text green/yellow/red based on a percentage threshold.
 * - ≥75% → green
 * - ≥25% → yellow
 * - <25% → red
 */
export function colorByPercent(text, pct) {
    if (pct >= 75)
        return chalk.green(text);
    if (pct >= 25)
        return chalk.yellow(text);
    return chalk.red(text);
}
//# sourceMappingURL=format.js.map