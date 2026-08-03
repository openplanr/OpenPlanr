/**
 * OpenAI Codex CLI agent adapter.
 *
 * Invokes `codex exec --full-auto --json` for non-interactive mode with
 * write access. Parses JSONL events for real-time progress display.
 * Includes retry logic for transient errors.
 */
import type { AgentOptions, AgentResult, CodingAgent } from './types.js';
export declare class CodexAgent implements CodingAgent {
    readonly name = "codex";
    isAvailable(): Promise<boolean>;
    execute(prompt: string, options: AgentOptions): Promise<AgentResult>;
    private spawnCodex;
    private buildArgs;
    private attachListeners;
}
//# sourceMappingURL=codex-agent.d.ts.map