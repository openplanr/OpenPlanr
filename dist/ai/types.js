/**
 * Core type definitions for the AI provider abstraction layer.
 *
 * All AI providers (Anthropic, OpenAI, Ollama) implement the `AIProvider`
 * interface, enabling seamless switching between backends.
 */
// ---------------------------------------------------------------------------
// Token budget constants
// ---------------------------------------------------------------------------
/** Default max output tokens when no command-specific budget is set. */
export const DEFAULT_MAX_TOKENS = 8192;
/**
 * Per-command token budgets tuned to typical output sizes.
 * Commands producing larger outputs get higher budgets.
 */
export const TOKEN_BUDGETS = {
    epic: 8192,
    feature: 8192,
    story: 8192,
    task: 16384,
    taskFeature: 32768,
    refine: 8192,
    /** Used by the `planr plan` pipeline for task generation per story. */
    plan: 16384,
    estimate: 4096,
    backlogPrioritize: 8192,
    sprintAutoSelect: 8192,
    /** `planr revise` — decision JSON is small, but revisedMarkdown may rewrite a full artifact. */
    revise: 16384,
};
export const DEFAULT_MODELS = {
    anthropic: 'claude-sonnet-4-20250514',
    openai: 'gpt-4o',
    ollama: 'llama3.1',
};
/** Environment variable names for API keys. Only cloud providers have entries; Ollama needs no key. */
export const ENV_KEY_MAP = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    /** Linear personal access token (`planr linear init`). */
    linear: 'PLANR_LINEAR_TOKEN',
};
/** Human-readable display names for AI providers. */
export const PROVIDER_LABELS = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    ollama: 'Ollama',
};
//# sourceMappingURL=types.js.map