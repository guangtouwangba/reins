import type { LLMProvider, LLMCompletionOpts } from './provider.js';

// ---------------------------------------------------------------------------
// StubLLMProvider — returns configurable responses for testing
// ---------------------------------------------------------------------------

export class StubLLMProvider implements LLMProvider {
  private responses: string[];
  private callIndex = 0;
  public calls: Array<{ prompt: string; opts?: LLMCompletionOpts }> = [];

  constructor(responses: string | string[] = '{}') {
    this.responses = Array.isArray(responses) ? responses : [responses];
  }

  async complete(prompt: string, opts?: LLMCompletionOpts): Promise<string> {
    this.calls.push({ prompt, opts });
    const response = this.responses[this.callIndex % this.responses.length]!;
    this.callIndex++;
    return response;
  }

  /** Reset call history and index */
  reset(): void {
    this.calls = [];
    this.callIndex = 0;
  }
}

// ---------------------------------------------------------------------------
// ErrorLLMProvider — always throws, for testing fallback paths
// ---------------------------------------------------------------------------

export class ErrorLLMProvider implements LLMProvider {
  private error: Error;

  constructor(message = 'LLM unavailable') {
    this.error = new Error(message);
  }

  async complete(_prompt: string, _opts?: LLMCompletionOpts): Promise<string> {
    throw this.error;
  }
}
