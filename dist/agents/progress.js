/**
 * Progress display for coding agent execution.
 *
 * Provides a dynamic spinner with rotating messages, elapsed time,
 * and real-time activity updates parsed from Claude's stream-json events.
 * Extracted as a shared module so any agent adapter can reuse it.
 */
import chalk from 'chalk';
// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const WAITING_MESSAGES = [
    'Warming up...',
    'Analyzing the task...',
    'Planning implementation...',
    'Thinking about the approach...',
    'Working on it...',
    'Crafting the solution...',
    'Reviewing the codebase...',
    'Preparing changes...',
    'Designing the architecture...',
    'Almost ready...',
    'Putting it all together...',
    'Fine-tuning the details...',
    'Working through the requirements...',
    'Building the implementation...',
    'Connecting the pieces...',
];
/** How often to rotate the generic waiting message (ms) */
const MESSAGE_ROTATE_MS = 8000;
export function formatElapsed(seconds) {
    if (seconds < 60)
        return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m${s > 0 ? ` ${s}s` : ''}`;
}
/**
 * Create a dynamic progress spinner that:
 * - Rotates through varied waiting messages every 8 seconds
 * - Switches to a specific activity when `setActivity()` is called
 * - Always shows elapsed time
 */
export function createProgressSpinner() {
    let frameIndex = 0;
    let messageIndex = 0;
    let currentActivity = '';
    let lastMessageChange = Date.now();
    const startTime = Date.now();
    const write = () => {
        const frame = chalk.cyan(SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length]);
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const timeStr = chalk.dim(`(${formatElapsed(elapsed)})`);
        let msg;
        if (currentActivity) {
            msg = currentActivity;
        }
        else {
            const now = Date.now();
            if (now - lastMessageChange > MESSAGE_ROTATE_MS) {
                messageIndex = (messageIndex + 1) % WAITING_MESSAGES.length;
                lastMessageChange = now;
            }
            msg = WAITING_MESSAGES[messageIndex] ?? '';
        }
        process.stderr.write(`\r\x1b[K${frame} ${chalk.dim(msg)} ${timeStr}`);
        frameIndex++;
    };
    write();
    const interval = setInterval(write, 80);
    return {
        setActivity(msg) {
            currentActivity = msg;
        },
        stop() {
            clearInterval(interval);
            process.stderr.write('\r\x1b[K');
        },
    };
}
/**
 * Parse a stream-json event into a human-readable activity description.
 * Returns `null` for events that don't represent a notable tool action.
 */
export function describeActivity(event) {
    if (event.type !== 'assistant' || !event.message?.content)
        return null;
    for (const block of event.message.content) {
        if (block.type !== 'tool_use')
            continue;
        const input = block.input;
        switch (block.name) {
            case 'Write':
                return `Creating ${shortPath(input?.file_path)}`;
            case 'Edit':
                return `Editing ${shortPath(input?.file_path)}`;
            case 'Read':
                return `Reading ${shortPath(input?.file_path)}`;
            case 'Bash': {
                const cmd = input?.command || '';
                const firstLine = cmd.split('\n')[0] || 'command';
                const display = firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
                return `$ ${display}`;
            }
            case 'Glob':
                return 'Searching files...';
            case 'Grep':
                return 'Searching code...';
            default:
                return `Using ${block.name}...`;
        }
    }
    return null;
}
/** Shorten a file path to its last two segments for display */
function shortPath(filePath) {
    if (!filePath)
        return 'file';
    const parts = filePath.split('/');
    return parts.length > 2 ? parts.slice(-2).join('/') : filePath;
}
/**
 * Parse a Codex JSONL event into a human-readable activity description.
 * Returns `null` for events that don't represent a notable action.
 */
export function describeCodexActivity(event) {
    if (!event.item)
        return null;
    if (event.type === 'item.started' && event.item.type === 'command_execution') {
        const cmd = event.item.command || '';
        // Strip the shell wrapper (e.g., `/bin/zsh -lc "..."`)
        const inner = cmd.replace(/^\/bin\/\w+\s+-\w+\s+/, '').replace(/^["']|["']$/g, '');
        const firstLine = inner.split('\n')[0] || 'command';
        const display = firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
        return `$ ${display}`;
    }
    if (event.type === 'item.completed' && event.item.type === 'command_execution') {
        const code = event.item.exit_code;
        if (code !== null && code !== undefined && code !== 0) {
            return `Command exited with code ${code}`;
        }
        return null; // Successful command completion — already shown at start
    }
    if (event.type === 'item.completed' && event.item.type === 'agent_message') {
        const text = event.item.text || '';
        // Show a brief preview of what the agent is saying
        const firstLine = text.split('\n')[0] || '';
        if (firstLine.length > 80)
            return `${firstLine.slice(0, 77)}...`;
        return firstLine || null;
    }
    return null;
}
//# sourceMappingURL=progress.js.map