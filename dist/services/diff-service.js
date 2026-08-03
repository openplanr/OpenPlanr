/**
 * Colored diff preview for revise.
 *
 * Wraps the pure `unifiedDiff` utility with chalk formatting. The returned
 * string is what the CLI prints before asking the user to apply / skip /
 * edit / re-view / quit.
 */
import chalk from 'chalk';
import { unifiedDiff } from '../utils/diff.js';
/**
 * Produce a unified diff between `oldText` and `newText`, color-coded for
 * terminal display. Returns the empty string when the two are identical.
 */
export function renderDiff(oldText, newText, options = {}) {
    const raw = unifiedDiff(oldText, newText, options);
    if (raw.length === 0)
        return '';
    if (options.color === false)
        return raw;
    return raw
        .split('\n')
        .map((line) => {
        if (line.startsWith('+++') || line.startsWith('---'))
            return chalk.bold(line);
        if (line.startsWith('@@'))
            return chalk.cyan(line);
        if (line.startsWith('+'))
            return chalk.green(line);
        if (line.startsWith('-'))
            return chalk.red(line);
        return chalk.dim(line);
    })
        .join('\n');
}
//# sourceMappingURL=diff-service.js.map