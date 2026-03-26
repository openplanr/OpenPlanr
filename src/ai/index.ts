/**
 * AI module public API.
 *
 * Re-exports the provider abstraction, factory, and error types.
 * All AI functionality is accessed through this barrel export.
 */

export type {
  AIProvider,
  AIMessage,
  AIRequestOptions,
  AIProviderConfig,
  AIProviderName,
  CodingAgentName,
} from './types.js';

export { DEFAULT_MODELS, ENV_KEY_MAP } from './types.js';
export { AIError, wrapProviderError } from './errors.js';
export { createAIProvider } from './provider-factory.js';
