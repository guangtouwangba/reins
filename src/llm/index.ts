export type { LLMProvider, LLMCompletionOpts } from './provider.js';
export { parseLLMJson } from './provider.js';
export { CliLLMProvider, isClaudeCliAvailable } from './cli-provider.js';
export { StubLLMProvider, ErrorLLMProvider } from './stub-provider.js';

import type { LLMProvider } from './provider.js';
import { CliLLMProvider } from './cli-provider.js';
import { StubLLMProvider } from './stub-provider.js';

// ---------------------------------------------------------------------------
// Singleton & override
// ---------------------------------------------------------------------------

let overrideProvider: LLMProvider | null = null;

/**
 * Override the LLM provider globally (useful for tests).
 * Pass null to reset to default behavior.
 */
export function setLLMProvider(provider: LLMProvider | null): void {
  overrideProvider = provider;
}

/**
 * Get the current LLM provider.
 * Priority: override > REINS_LLM=stub env var > CliLLMProvider default.
 */
export function getLLMProvider(): LLMProvider {
  if (overrideProvider) return overrideProvider;
  if (process.env['REINS_LLM'] === 'stub') return new StubLLMProvider();
  return new CliLLMProvider();
}
