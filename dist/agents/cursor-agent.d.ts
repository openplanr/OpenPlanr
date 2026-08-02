/**
 * Cursor agent adapter.
 *
 * Since Cursor is GUI-based, this agent writes the implementation
 * prompt to a file that Cursor can read from its Composer panel.
 * For follow-up/fix prompts, it appends to the same file.
 */
import type { AgentOptions, AgentResult, CodingAgent } from './types.js';
export declare class CursorAgent implements CodingAgent {
    readonly name = "cursor";
    isAvailable(): Promise<boolean>;
    execute(prompt: string, options: AgentOptions): Promise<AgentResult>;
}
//# sourceMappingURL=cursor-agent.d.ts.map