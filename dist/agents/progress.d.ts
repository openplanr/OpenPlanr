/**
 * Progress display for coding agent execution.
 *
 * Provides a dynamic spinner with rotating messages, elapsed time,
 * and real-time activity updates parsed from Claude's stream-json events.
 * Extracted as a shared module so any agent adapter can reuse it.
 */
export interface ProgressSpinner {
    /** Update the spinner with a specific tool-activity message */
    setActivity(msg: string): void;
    /** Stop the spinner and clear the line */
    stop(): void;
}
export declare function formatElapsed(seconds: number): string;
/**
 * Create a dynamic progress spinner that:
 * - Rotates through varied waiting messages every 8 seconds
 * - Switches to a specific activity when `setActivity()` is called
 * - Always shows elapsed time
 */
export declare function createProgressSpinner(): ProgressSpinner;
/** Minimal shape of the Claude stream-json events we need */
export interface StreamEvent {
    type: string;
    message?: {
        content?: Array<{
            type: string;
            name?: string;
            input?: Record<string, unknown>;
        }>;
    };
    result?: string;
}
/**
 * Parse a stream-json event into a human-readable activity description.
 * Returns `null` for events that don't represent a notable tool action.
 */
export declare function describeActivity(event: StreamEvent): string | null;
/** Minimal shape of Codex exec --json events */
export interface CodexEvent {
    type: string;
    item?: {
        id?: string;
        type?: string;
        text?: string;
        command?: string;
        aggregated_output?: string;
        exit_code?: number | null;
        status?: string;
    };
    usage?: {
        input_tokens?: number;
        cached_input_tokens?: number;
        output_tokens?: number;
    };
}
/**
 * Parse a Codex JSONL event into a human-readable activity description.
 * Returns `null` for events that don't represent a notable action.
 */
export declare function describeCodexActivity(event: CodexEvent): string | null;
//# sourceMappingURL=progress.d.ts.map