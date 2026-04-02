import { describe, it, expect, afterEach } from 'vitest';
import { generateQuestions } from './question-engine.js';
import { setLLMProvider } from '../llm/index.js';
import { StubLLMProvider, ErrorLLMProvider } from '../llm/stub-provider.js';
import type { CodebaseContext } from '../scanner/types.js';

// Minimal context for tests
function minimalContext(): CodebaseContext {
  return {
    structure: { files: [], directories: [] },
    stack: { language: ['TypeScript'], framework: ['express'], packageManager: 'pnpm', buildTool: '', testFramework: '' },
    architecture: { pattern: 'api', layers: [] },
    testing: {},
    dependencies: { direct: {}, dev: {} },
    conventions: {},
  } as unknown as CodebaseContext;
}

afterEach(() => setLLMProvider(null));

describe('generateQuestions', () => {
  it('returns universal questions when LLM returns empty', async () => {
    setLLMProvider(new StubLLMProvider('[]'));
    const result = await generateQuestions('add user auth', minimalContext(), []);
    expect(result.blocking.length).toBeGreaterThan(0);
    expect(result.inferred).toBeDefined();
  });

  it('includes LLM-generated task-specific questions', async () => {
    const llmResponse = JSON.stringify([
      { id: 'task-1', dimension: 'performance', text: 'Expected request rate?', priority: 'important' },
      { id: 'task-2', dimension: 'caching', text: 'Cache TTL?', priority: 'optional', default: '5 minutes' },
    ]);
    setLLMProvider(new StubLLMProvider(llmResponse));
    const result = await generateQuestions('add caching layer', minimalContext(), []);
    const allQs = [...result.blocking, ...result.important, ...result.optional];
    expect(allQs.some(q => q.id === 'task-1')).toBe(true);
    expect(allQs.some(q => q.id === 'task-2')).toBe(true);
  });

  it('returns gracefully on LLM error', async () => {
    setLLMProvider(new ErrorLLMProvider('network error'));
    const result = await generateQuestions('add feature', minimalContext(), []);
    // Should still return universal questions, just no task-specific
    expect(result.blocking.length).toBeGreaterThan(0);
  });

  it('handles invalid LLM JSON gracefully', async () => {
    setLLMProvider(new StubLLMProvider('not valid json'));
    const result = await generateQuestions('build API', minimalContext(), []);
    expect(result.blocking.length).toBeGreaterThan(0);
  });

  it('filters out malformed question objects from LLM', async () => {
    const llmResponse = JSON.stringify([
      { id: 'task-1', dimension: 'perf', text: 'Good question?', priority: 'important' },
      { missing: 'fields' },
      { id: 'task-3' }, // missing text and dimension
    ]);
    setLLMProvider(new StubLLMProvider(llmResponse));
    const result = await generateQuestions('task', minimalContext(), []);
    const taskQs = [...result.blocking, ...result.important, ...result.optional].filter(q => q.id.startsWith('task-'));
    expect(taskQs).toHaveLength(1);
    expect(taskQs[0]!.id).toBe('task-1');
  });
});
