/**
 * Claude Code CLI agent adapter.
 *
 * Spawns `claude --print` with stream-json output, showing real-time
 * progress via the shared progress spinner. Includes automatic retry
 * for transient API errors.
 */
import type { AgentOptions, AgentResult, CodingAgent } from './types.js';
export declare class ClaudeAgent implements CodingAgent {
    readonly name = "claude";
    isAvailable(): Promise<boolean>;
    execute(prompt: string, options: AgentOptions): Promise<AgentResult>;
    private spawnClaude;
    private buildArgs;
    private attachListeners;
    private printSummary;
}
//# sourceMappingURL=claude-agent.d.ts.map