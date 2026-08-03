/**
 * Factory for creating coding agent instances.
 */
export async function createAgent(name) {
    switch (name) {
        case 'claude': {
            const { ClaudeAgent } = await import('./claude-agent.js');
            return new ClaudeAgent();
        }
        case 'cursor': {
            const { CursorAgent } = await import('./cursor-agent.js');
            return new CursorAgent();
        }
        case 'codex': {
            const { CodexAgent } = await import('./codex-agent.js');
            return new CodexAgent();
        }
        default:
            throw new Error(`Unknown coding agent: ${name}. Supported: claude, cursor, codex.`);
    }
}
//# sourceMappingURL=agent-factory.js.map