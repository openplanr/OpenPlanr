/**
 * Factory for creating AI provider instances.
 *
 * Uses dynamic imports to lazy-load SDK dependencies — the heavy
 * @anthropic-ai/sdk and openai packages are only loaded when AI
 * features are actually invoked.
 */
import type { AIProvider, AIProviderConfig } from './types.js';
export declare function createAIProvider(config: AIProviderConfig): Promise<AIProvider>;
//# sourceMappingURL=provider-factory.d.ts.map