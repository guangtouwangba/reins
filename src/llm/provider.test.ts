import { describe, it, expect, afterEach } from 'vitest';
import { parseLLMJson } from './provider.js';
import { StubLLMProvider, ErrorLLMProvider } from './stub-provider.js';
import { getLLMProvider, setLLMProvider } from './index.js';

// ---------------------------------------------------------------------------
// parseLLMJson
// ---------------------------------------------------------------------------

describe('parseLLMJson', () => {
  it('parses valid JSON string', () => {
    const result = parseLLMJson<{ x: number }>('{"x": 42}');
    expect(result).toEqual({ x: 42 });
  });

  it('strips markdown json fences', () => {
    const result = parseLLMJson<{ a: string }>('```json\n{"a":"b"}\n```');
    expect(result).toEqual({ a: 'b' });
  });

  it('strips plain markdown fences', () => {
    const result = parseLLMJson<{ a: number }>('```\n{"a":1}\n```');
    expect(result).toEqual({ a: 1 });
  });

  it('returns null on invalid JSON', () => {
    expect(parseLLMJson('not json')).toBeNull();
  });

  it('returns null on empty string', () => {
    expect(parseLLMJson('')).toBeNull();
  });

  it('handles whitespace around JSON', () => {
    const result = parseLLMJson<{ k: boolean }>('  \n {"k": true} \n ');
    expect(result).toEqual({ k: true });
  });
});

// ---------------------------------------------------------------------------
// StubLLMProvider
// ---------------------------------------------------------------------------

describe('StubLLMProvider', () => {
  it('returns configured response', async () => {
    const provider = new StubLLMProvider('hello world');
    const result = await provider.complete('test prompt');
    expect(result).toBe('hello world');
  });

  it('cycles through multiple responses', async () => {
    const provider = new StubLLMProvider(['first', 'second']);
    expect(await provider.complete('p1')).toBe('first');
    expect(await provider.complete('p2')).toBe('second');
    expect(await provider.complete('p3')).toBe('first'); // cycles
  });

  it('records calls', async () => {
    const provider = new StubLLMProvider('ok');
    await provider.complete('prompt1', { model: 'haiku' });
    await provider.complete('prompt2');
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0]!.prompt).toBe('prompt1');
    expect(provider.calls[0]!.opts).toEqual({ model: 'haiku' });
    expect(provider.calls[1]!.prompt).toBe('prompt2');
  });

  it('resets call history', async () => {
    const provider = new StubLLMProvider('ok');
    await provider.complete('test');
    provider.reset();
    expect(provider.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ErrorLLMProvider
// ---------------------------------------------------------------------------

describe('ErrorLLMProvider', () => {
  it('throws on complete', async () => {
    const provider = new ErrorLLMProvider('test error');
    await expect(provider.complete('prompt')).rejects.toThrow('test error');
  });

  it('uses default message when none provided', async () => {
    const provider = new ErrorLLMProvider();
    await expect(provider.complete('prompt')).rejects.toThrow('LLM unavailable');
  });
});

// ---------------------------------------------------------------------------
// getLLMProvider / setLLMProvider
// ---------------------------------------------------------------------------

describe('getLLMProvider', () => {
  afterEach(() => {
    setLLMProvider(null);
  });

  it('returns CliLLMProvider by default', () => {
    const provider = getLLMProvider();
    expect(provider.constructor.name).toBe('CliLLMProvider');
  });

  it('returns override when set', () => {
    const stub = new StubLLMProvider('test');
    setLLMProvider(stub);
    expect(getLLMProvider()).toBe(stub);
  });

  it('returns default after clearing override', () => {
    setLLMProvider(new StubLLMProvider('x'));
    setLLMProvider(null);
    expect(getLLMProvider().constructor.name).toBe('CliLLMProvider');
  });
});
