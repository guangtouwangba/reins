import { describe, it, expect, afterEach } from 'vitest';
import {
  buildSemanticPrompt,
  parseSemanticResult,
  runL4Semantic,
} from './l4-semantic.js';
import type { FileChange, VerificationResult } from './l4-semantic.js';
import { setLLMProvider } from '../llm/index.js';
import { StubLLMProvider, ErrorLLMProvider } from '../llm/stub-provider.js';

// ---------------------------------------------------------------------------
// buildSemanticPrompt
// ---------------------------------------------------------------------------

describe('buildSemanticPrompt', () => {
  const baseVerification: VerificationResult = {
    l0Passed: true,
    l1Passed: true,
    l2Passed: true,
  };

  it('includes the task description', () => {
    const prompt = buildSemanticPrompt('Add login endpoint', [], baseVerification);
    expect(prompt).toContain('Add login endpoint');
  });

  it('includes file diffs when provided', () => {
    const files: FileChange[] = [
      { path: 'src/auth.ts', diff: '+export function login() {}' },
    ];
    const prompt = buildSemanticPrompt('Add login', files, baseVerification);
    expect(prompt).toContain('src/auth.ts');
    expect(prompt).toContain('+export function login() {}');
  });

  it('shows no diff available when diff is absent', () => {
    const files: FileChange[] = [{ path: 'src/foo.ts' }];
    const prompt = buildSemanticPrompt('task', files, baseVerification);
    expect(prompt).toContain('src/foo.ts');
    expect(prompt).toContain('no diff available');
  });

  it('includes verification results as JSON', () => {
    const prompt = buildSemanticPrompt('task', [], baseVerification);
    expect(prompt).toContain('"l0Passed": true');
    expect(prompt).toContain('"l1Passed": true');
    expect(prompt).toContain('"l2Passed": true');
  });

  it('shows no changed files message when files array is empty', () => {
    const prompt = buildSemanticPrompt('task', [], baseVerification);
    expect(prompt).toContain('no changed files');
  });

  it('requests JSON output format', () => {
    const prompt = buildSemanticPrompt('task', [], baseVerification);
    expect(prompt).toContain('"confidence"');
    expect(prompt).toContain('"completeness"');
    expect(prompt).toContain('"issues"');
    expect(prompt).toContain('"suggestions"');
  });
});

// ---------------------------------------------------------------------------
// parseSemanticResult
// ---------------------------------------------------------------------------

describe('parseSemanticResult', () => {
  it('parses valid JSON', () => {
    const raw = JSON.stringify({
      confidence: 85,
      completeness: 'all requirements met',
      issues: [],
      suggestions: ['add more tests'],
    });
    const result = parseSemanticResult(raw);
    expect(result.confidence).toBe(85);
    expect(result.completeness).toBe('all requirements met');
    expect(result.issues).toEqual([]);
    expect(result.suggestions).toEqual(['add more tests']);
  });

  it('strips markdown fences before parsing', () => {
    const raw = '```json\n{"confidence":70,"completeness":"ok","issues":[],"suggestions":[]}\n```';
    const result = parseSemanticResult(raw);
    expect(result.confidence).toBe(70);
  });

  it('strips plain markdown fences', () => {
    const raw = '```\n{"confidence":60,"completeness":"partial","issues":["missing error handling"],"suggestions":[]}\n```';
    const result = parseSemanticResult(raw);
    expect(result.confidence).toBe(60);
    expect(result.issues).toContain('missing error handling');
  });

  it('returns fallback with confidence 0 on parse failure', () => {
    const result = parseSemanticResult('not valid json at all');
    expect(result.confidence).toBe(0);
    expect(result.completeness).toBe('parse error');
    expect(result.issues).toContain('failed to parse LLM response');
  });

  it('clamps confidence to 0-100 range', () => {
    const tooHigh = JSON.stringify({ confidence: 150, completeness: 'ok', issues: [], suggestions: [] });
    expect(parseSemanticResult(tooHigh).confidence).toBe(100);

    const tooLow = JSON.stringify({ confidence: -10, completeness: 'ok', issues: [], suggestions: [] });
    expect(parseSemanticResult(tooLow).confidence).toBe(0);
  });

  it('handles missing fields gracefully', () => {
    const raw = JSON.stringify({ confidence: 50 });
    const result = parseSemanticResult(raw);
    expect(result.confidence).toBe(50);
    expect(result.completeness).toBe('unknown');
    expect(result.issues).toEqual([]);
    expect(result.suggestions).toEqual([]);
  });

  it('filters non-string items from issues and suggestions arrays', () => {
    const raw = JSON.stringify({
      confidence: 80,
      completeness: 'ok',
      issues: ['real issue', 42, null, 'another issue'],
      suggestions: [true, 'valid suggestion'],
    });
    const result = parseSemanticResult(raw);
    expect(result.issues).toEqual(['real issue', 'another issue']);
    expect(result.suggestions).toEqual(['valid suggestion']);
  });
});

// ---------------------------------------------------------------------------
// runL4Semantic
// ---------------------------------------------------------------------------

describe('runL4Semantic', () => {
  afterEach(() => setLLMProvider(null));

  it('returns default confidence of 70 (stub)', async () => {
    setLLMProvider(new StubLLMProvider(
      '{"confidence":85,"completeness":"all done","issues":[],"suggestions":["more tests"]}',
    ));
    const result = await runL4Semantic('task', [], {
      l0Passed: true,
      l1Passed: true,
      l2Passed: true,
    });
    expect(result.confidence).toBe(85);
  });

  it('returns a SemanticReviewResult shape', async () => {
    setLLMProvider(new StubLLMProvider(
      '{"confidence":50,"completeness":"partial","issues":[],"suggestions":[]}',
    ));
    const result = await runL4Semantic('implement feature', [], {
      l0Passed: false,
      l1Passed: false,
      l2Passed: false,
    });
    expect(typeof result.confidence).toBe('number');
    expect(typeof result.completeness).toBe('string');
    expect(Array.isArray(result.issues)).toBe(true);
    expect(Array.isArray(result.suggestions)).toBe(true);
  });

  it('returns fallback on LLM error', async () => {
    setLLMProvider(new ErrorLLMProvider('simulated failure'));
    const result = await runL4Semantic('task', [], {
      l0Passed: true,
      l1Passed: true,
      l2Passed: true,
    });
    expect(result.confidence).toBe(0);
    expect(result.issues.some(i => i.includes('LLM error'))).toBe(true);
  });
});
