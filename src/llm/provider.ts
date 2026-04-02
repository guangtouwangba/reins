// ---------------------------------------------------------------------------
// LLM Provider interface
// ---------------------------------------------------------------------------

export interface LLMCompletionOpts {
  /** Max tokens for response */
  maxTokens?: number;
  /** Model hint (e.g. 'haiku', 'sonnet', 'opus') */
  model?: string;
  /** Temperature (0-1) */
  temperature?: number;
}

export interface LLMProvider {
  /** Send a prompt and receive a text completion */
  complete(prompt: string, opts?: LLMCompletionOpts): Promise<string>;
}

// ---------------------------------------------------------------------------
// JSON parse helper
// ---------------------------------------------------------------------------

/**
 * Attempt to parse a JSON response from LLM output.
 * Strips markdown fences if present, returns null on failure.
 */
export function parseLLMJson<T>(raw: string): T | null {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  }
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}
