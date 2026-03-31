import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkPromotion, evaluatePromotions, checkDemotion } from './promoter.js';
import { checkSessionConsistency } from './consistency.js';
import { saveKnowledgeIndex, loadKnowledgeIndex } from './staleness.js';
import type { KnowledgeEntry } from './staleness.js';
import type { BypassEvent } from './promoter.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `reins-promotion-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = makeTmpDir();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: 'k-001',
    title: 'Test entry',
    content: 'Test content',
    file: 'test.md',
    related_files: [],
    confidence: 95,
    created: '2026-01-01',
    injection_outcomes: { success: 6, failure: 1 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// checkPromotion
// ---------------------------------------------------------------------------

describe('checkPromotion', () => {
  it('returns null when confidence < 90', () => {
    const entry = makeEntry({ confidence: 85 });
    expect(checkPromotion(entry as any)).toBeNull();
  });

  it('returns null when success count < 5', () => {
    const entry = makeEntry({ injection_outcomes: { success: 3, failure: 0 } });
    expect(checkPromotion(entry as any)).toBeNull();
  });

  it('returns null when success rate < 80%', () => {
    const entry = makeEntry({ injection_outcomes: { success: 5, failure: 5 } });
    expect(checkPromotion(entry as any)).toBeNull();
  });

  it('returns candidate for preference type → constraint', () => {
    const entry = makeEntry({ confidence: 92 });
    // Note: knowledge types in promoter come from knowledge/types.ts, not staleness.ts
    // The promoter accepts KnowledgeEntry from types.ts which has type field
    const candidate = checkPromotion({
      ...entry,
      type: 'preference',
    } as any);
    expect(candidate).not.toBeNull();
    expect(candidate!.targetType).toBe('constraint');
  });

  it('returns candidate for coupling type → constraint', () => {
    const candidate = checkPromotion({ ...makeEntry(), type: 'coupling' } as any);
    expect(candidate).not.toBeNull();
    expect(candidate!.targetType).toBe('constraint');
  });

  it('returns candidate for gotcha type → skill', () => {
    const candidate = checkPromotion({ ...makeEntry(), type: 'gotcha' } as any);
    expect(candidate).not.toBeNull();
    expect(candidate!.targetType).toBe('skill');
  });

  it('returns candidate for decision type → l1_addition', () => {
    const candidate = checkPromotion({ ...makeEntry(), type: 'decision' } as any);
    expect(candidate).not.toBeNull();
    expect(candidate!.targetType).toBe('l1_addition');
  });

  it('reason string includes validation count and success rate', () => {
    const candidate = checkPromotion(makeEntry() as any);
    expect(candidate).not.toBeNull();
    expect(candidate!.reason).toContain('6');
    expect(candidate!.reason).toContain('%');
  });
});

// ---------------------------------------------------------------------------
// evaluatePromotions
// ---------------------------------------------------------------------------

describe('evaluatePromotions', () => {
  it('filters entries that do not meet conditions', () => {
    const entries = [
      makeEntry({ id: 'k-001', confidence: 85 }),  // fails confidence
      makeEntry({ id: 'k-002', injection_outcomes: { success: 2, failure: 0 } }), // fails count
      makeEntry({ id: 'k-003', confidence: 92, injection_outcomes: { success: 6, failure: 1 } }), // passes
    ];
    const candidates = evaluatePromotions(entries as any);
    expect(candidates.length).toBe(1);
    expect(candidates[0]!.knowledge.id).toBe('k-003');
  });

  it('returns empty array for empty input', () => {
    expect(evaluatePromotions([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// checkDemotion
// ---------------------------------------------------------------------------

describe('checkDemotion', () => {
  it('returns null when bypass count <= 5', () => {
    const events: BypassEvent[] = [
      { rule: 'no-eval', timestamp: '2026-01-01', outcome: 'success' },
      { rule: 'no-eval', timestamp: '2026-01-02', outcome: 'success' },
    ];
    expect(checkDemotion('no-eval', events)).toBeNull();
  });

  it('returns null when success rate <= 90%', () => {
    const events: BypassEvent[] = Array.from({ length: 10 }, (_, i) => ({
      rule: 'strict-rule',
      timestamp: `2026-01-${String(i + 1).padStart(2, '0')}`,
      outcome: i < 8 ? 'success' : 'failure',
    }));
    // successRate = 8/10 = 0.8, <= 0.9 → null
    expect(checkDemotion('strict-rule', events)).toBeNull();
  });

  it('returns demotion suggestion when conditions met', () => {
    const events: BypassEvent[] = Array.from({ length: 10 }, (_, i) => ({
      rule: 'overly-strict',
      timestamp: `2026-01-${String(i + 1).padStart(2, '0')}`,
      outcome: 'success' as const,
    }));
    const result = checkDemotion('overly-strict', events);
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('overly-strict');
    expect(result!.suggestion).toBe('downgrade_to_preference');
    expect(result!.successRate).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// checkSessionConsistency
// ---------------------------------------------------------------------------

describe('checkSessionConsistency', () => {
  it('returns zero report when no knowledge entries', () => {
    const report = checkSessionConsistency(tmpDir, ['src/index.ts']);
    expect(report.reviewed).toBe(0);
    expect(report.staleMarked).toBe(0);
  });

  it('returns zero report when no modified files', () => {
    const index = {
      version: 1,
      entries: [makeEntry({ id: 'k-001', related_files: ['src/auth.ts'] })],
    };
    saveKnowledgeIndex(tmpDir, index);
    const report = checkSessionConsistency(tmpDir, []);
    expect(report.staleMarked).toBe(0);
  });

  it('marks affected entries as needing review', () => {
    const index = {
      version: 1,
      entries: [
        makeEntry({
          id: 'k-001',
          related_files: ['src/auth.ts'],
          confidence: 90,
        }),
        makeEntry({
          id: 'k-002',
          related_files: ['src/unrelated.ts'],
          confidence: 90,
        }),
      ],
    };
    saveKnowledgeIndex(tmpDir, index);

    const report = checkSessionConsistency(tmpDir, ['src/auth.ts']);
    expect(report.staleMarked).toBe(1);
    expect(report.entries).toContain('k-001');
    expect(report.entries).not.toContain('k-002');
  });

  it('lowers confidence by 10 for affected entries', () => {
    const index = {
      version: 1,
      entries: [makeEntry({ id: 'k-001', related_files: ['src/auth.ts'], confidence: 90 })],
    };
    saveKnowledgeIndex(tmpDir, index);

    checkSessionConsistency(tmpDir, ['src/auth.ts']);

    const updated = loadKnowledgeIndex(tmpDir);
    expect(updated.entries[0]!.confidence).toBe(80);
    expect(updated.entries[0]!.needs_review).toBe(true);
  });

  it('does not lower confidence below 0', () => {
    const index = {
      version: 1,
      entries: [makeEntry({ id: 'k-001', related_files: ['src/auth.ts'], confidence: 5 })],
    };
    saveKnowledgeIndex(tmpDir, index);

    checkSessionConsistency(tmpDir, ['src/auth.ts']);

    const updated = loadKnowledgeIndex(tmpDir);
    expect(updated.entries[0]!.confidence).toBe(0);
  });
});
