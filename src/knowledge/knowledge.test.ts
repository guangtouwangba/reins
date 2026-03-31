import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadIndex, saveIndex, saveEntry, loadEntry, generateId, generateFilename } from './store.js';
import { buildReflectionPrompt, parseReflectionOutput } from './reflector.js';
import { detectCorrectionSignal, buildCorrectionPrompt, buildRetryPrompt, parseExtractorOutput } from './extractor.js';
import { retrieveKnowledge } from './retriever.js';
import { formatInjection } from './injector.js';
import type { KnowledgeEntry, KnowledgeIndex } from './types.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `reins-knowledge-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(join(tmpDir, '.reins'), { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: 'k-001',
    type: 'gotcha',
    summary: 'Test summary',
    detail: 'Test detail. More context here.',
    related_files: [],
    tags: ['test'],
    confidence: 80,
    source: 'reflection',
    created: new Date().toISOString().split('T')[0]!,
    last_validated: new Date().toISOString().split('T')[0]!,
    last_injected: '',
    injection_outcomes: { success: 0, failure: 0 },
    file: 'gotcha-test-summary.md',
    ...overrides,
  };
}

describe('store', () => {
  it('loadIndex returns empty index when no file exists', () => {
    const index = loadIndex(tmpDir);
    expect(index.version).toBe(1);
    expect(index.entries).toEqual([]);
  });

  it('saveIndex and loadIndex round-trip', () => {
    const index: KnowledgeIndex = {
      version: 1,
      entries: [makeEntry()],
    };
    saveIndex(tmpDir, index);
    const loaded = loadIndex(tmpDir);
    expect(loaded.entries.length).toBe(1);
    expect(loaded.entries[0]!.id).toBe('k-001');
  });

  it('saveEntry creates markdown file and updates index', () => {
    const entry = makeEntry({ id: 'k-001' });
    saveEntry(tmpDir, entry);

    expect(existsSync(join(tmpDir, '.reins', 'knowledge', 'gotcha-test-summary.md'))).toBe(true);

    const index = loadIndex(tmpDir);
    expect(index.entries.length).toBe(1);
    expect(index.entries[0]!.id).toBe('k-001');
  });

  it('saveEntry updates existing entry in index', () => {
    const entry = makeEntry({ id: 'k-001', summary: 'Original' });
    saveEntry(tmpDir, entry);

    const updated = { ...entry, summary: 'Updated', file: 'gotcha-updated.md' };
    saveEntry(tmpDir, updated);

    const index = loadIndex(tmpDir);
    expect(index.entries.length).toBe(1);
    expect(index.entries[0]!.summary).toBe('Updated');
  });

  it('loadEntry returns null for unknown id', () => {
    const result = loadEntry(tmpDir, 'k-999');
    expect(result).toBeNull();
  });

  it('loadEntry returns entry from index', () => {
    const entry = makeEntry({ id: 'k-001' });
    saveEntry(tmpDir, entry);

    const loaded = loadEntry(tmpDir, 'k-001');
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe('k-001');
  });

  it('generateId returns k-001 for empty index', () => {
    const id = generateId(tmpDir);
    expect(id).toBe('k-001');
  });

  it('generateId increments past existing entries', () => {
    saveEntry(tmpDir, makeEntry({ id: 'k-001' }));
    saveEntry(tmpDir, makeEntry({ id: 'k-002', file: 'gotcha-second.md' }));
    const id = generateId(tmpDir);
    expect(id).toBe('k-003');
  });

  it('generateFilename produces slug from summary', () => {
    const filename = generateFilename('gotcha', 'Prisma is incompatible with Edge Runtime');
    expect(filename).toBe('gotcha-prisma-is-incompatible-with-edge-runtime.md');
  });

  it('generateFilename handles special characters', () => {
    const filename = generateFilename('coupling', 'auth/session & webhook!');
    expect(filename).toMatch(/^coupling-/);
    expect(filename).toMatch(/\.md$/);
  });
});

describe('reflector', () => {
  it('buildReflectionPrompt includes task description', () => {
    const prompt = buildReflectionPrompt('Implement user authentication');
    expect(prompt).toContain('Implement user authentication');
  });

  it('buildReflectionPrompt includes all 4 questions', () => {
    const prompt = buildReflectionPrompt('test task');
    expect(prompt).toContain('coupling');
    expect(prompt).toContain('gotcha');
    expect(prompt).toContain('decision');
    expect(prompt).toContain('heuristic');
  });

  it('parseReflectionOutput extracts YAML blocks', () => {
    const raw = `Some text here.

---
type: gotcha
summary: "Prisma is incompatible with Edge Runtime"
detail: "Using Prisma in edge functions throws runtime errors because of Node.js native modules."
related_files:
  - "lib/db.ts"
confidence: 85
---

More text.

---
type: decision
summary: "Use Result pattern for error handling"
detail: "Returning Result<T, E> instead of throwing makes error handling explicit."
related_files: []
confidence: 75
---`;

    const entries = parseReflectionOutput(raw);
    expect(entries.length).toBe(2);
    expect(entries[0]!.type).toBe('gotcha');
    expect(entries[0]!.summary).toBe('Prisma is incompatible with Edge Runtime');
    expect(entries[0]!.related_files).toEqual(['lib/db.ts']);
    expect(entries[1]!.type).toBe('decision');
  });

  it('parseReflectionOutput skips incomplete blocks', () => {
    const raw = `---
type: gotcha
summary: "Missing detail"
---`;
    const entries = parseReflectionOutput(raw);
    expect(entries.length).toBe(0);
  });

  it('parseReflectionOutput maps heuristic to preference', () => {
    const raw = `---
type: heuristic
summary: "Check the docs first"
detail: "Always read the framework docs before implementing. Saves a lot of time."
confidence: 70
---`;
    const entries = parseReflectionOutput(raw);
    expect(entries.length).toBe(1);
    expect(entries[0]!.type).toBe('preference');
  });

  it('parseReflectionOutput returns empty array for no blocks', () => {
    const entries = parseReflectionOutput('No YAML blocks here.');
    expect(entries.length).toBe(0);
  });
});

describe('extractor', () => {
  it('detectCorrectionSignal returns true for negation keywords', () => {
    expect(detectCorrectionSignal("No, don't do that")).toBe(true);
    expect(detectCorrectionSignal("That's wrong")).toBe(true);
    expect(detectCorrectionSignal("Stop doing this")).toBe(true);
    expect(detectCorrectionSignal("不对，换个方式")).toBe(true);
  });

  it('detectCorrectionSignal returns false for normal messages', () => {
    expect(detectCorrectionSignal("Great work, thanks!")).toBe(false);
    expect(detectCorrectionSignal("Please continue")).toBe(false);
  });

  it('buildCorrectionPrompt includes original and correction', () => {
    const prompt = buildCorrectionPrompt('Used class-based approach', 'Use functional approach');
    expect(prompt).toContain('Used class-based approach');
    expect(prompt).toContain('Use functional approach');
  });

  it('buildRetryPrompt includes all three parts', () => {
    const prompt = buildRetryPrompt('Used glob import', 'Module not found', 'Used explicit import');
    expect(prompt).toContain('Used glob import');
    expect(prompt).toContain('Module not found');
    expect(prompt).toContain('Used explicit import');
  });

  it('parseExtractorOutput parses valid YAML block', () => {
    const raw = `---
type: preference
summary: "Always use explicit imports"
detail: "Glob imports cause module resolution issues in bundlers."
scope: global
related_files: []
confidence: 80
---`;
    const result = parseExtractorOutput(raw);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('preference');
    expect(result!.summary).toBe('Always use explicit imports');
    expect(result!.confidence).toBe(80);
  });

  it('parseExtractorOutput returns null for invalid input', () => {
    expect(parseExtractorOutput('no yaml block')).toBeNull();
    expect(parseExtractorOutput('')).toBeNull();
  });
});

describe('retriever', () => {
  function populateIndex(): void {
    const entries: KnowledgeEntry[] = [
      makeEntry({
        id: 'k-001',
        type: 'gotcha',
        summary: 'Prisma incompatible with Edge Runtime',
        detail: 'Do not use standard Prisma client in edge functions.',
        related_files: ['lib/db/prisma.ts'],
        tags: ['prisma', 'edge', 'runtime'],
        confidence: 90,
        file: 'gotcha-prisma-edge.md',
        created: '2026-03-01',
      }),
      makeEntry({
        id: 'k-002',
        type: 'coupling',
        summary: 'Auth session shares state with webhook handler',
        detail: 'Modifying session format requires syncing webhook parser.',
        related_files: ['lib/auth/session.ts', 'app/api/webhooks/handler.ts'],
        tags: ['auth', 'session', 'webhook'],
        confidence: 85,
        file: 'coupling-auth-webhook.md',
        created: '2026-03-15',
      }),
      makeEntry({
        id: 'k-003',
        type: 'decision',
        summary: 'Use Result pattern for error handling',
        detail: 'Explicit error handling makes failure modes visible.',
        related_files: [],
        tags: ['error', 'pattern', 'result'],
        confidence: 75,
        file: 'decision-result-pattern.md',
        created: '2026-01-01',
      }),
    ];

    const index: KnowledgeIndex = { version: 1, entries };
    saveIndex(tmpDir, index);
  }

  it('returns empty array when no knowledge exists', () => {
    const results = retrieveKnowledge(tmpDir, { prompt: 'some task' });
    expect(results).toEqual([]);
  });

  it('returns top results sorted by score', () => {
    populateIndex();
    const results = retrieveKnowledge(tmpDir, {
      prompt: 'working with prisma database queries',
      recentFiles: ['lib/db/prisma.ts'],
    });
    expect(results.length).toBeGreaterThan(0);
    // k-001 should score highest due to file match + tag match
    expect(results[0]!.entry.id).toBe('k-001');
  });

  it('filters below minConfidence', () => {
    populateIndex();
    const results = retrieveKnowledge(tmpDir, {
      prompt: 'any task',
      minConfidence: 95,
    });
    // All entries are below 95 confidence
    expect(results.length).toBe(0);
  });

  it('respects maxResults', () => {
    populateIndex();
    const results = retrieveKnowledge(tmpDir, {
      prompt: 'any task',
      maxResults: 1,
    });
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('matches by tag keywords from prompt', () => {
    populateIndex();
    const results = retrieveKnowledge(tmpDir, {
      prompt: 'auth session update',
    });
    // k-002 has auth + session tags
    const found = results.find(r => r.entry.id === 'k-002');
    expect(found).toBeDefined();
  });

  it('includes matchReasons', () => {
    populateIndex();
    const results = retrieveKnowledge(tmpDir, {
      prompt: 'task',
      recentFiles: ['lib/db/prisma.ts'],
    });
    const k1 = results.find(r => r.entry.id === 'k-001');
    expect(k1).toBeDefined();
    expect(k1!.matchReasons.some(r => r.includes('file:'))).toBe(true);
  });
});

describe('injector', () => {
  it('returns empty string for empty entries', () => {
    const result = formatInjection([]);
    expect(result).toBe('');
  });

  it('formats single entry', () => {
    const entry = makeEntry({
      id: 'k-001',
      type: 'gotcha',
      summary: 'Prisma incompatible with Edge Runtime',
      detail: 'Do not use standard Prisma in edge. Use @prisma/client/edge instead.',
      file: 'gotcha-prisma-edge.md',
    });
    const result = formatInjection([{ entry, score: 0.9, matchReasons: [] }]);
    expect(result).toContain('[Reins Knowledge]');
    expect(result).toContain('[gotcha]');
    expect(result).toContain('Prisma incompatible with Edge Runtime');
    expect(result).toContain('.reins/knowledge/gotcha-prisma-edge.md');
  });

  it('formats multiple entries', () => {
    const entries = [
      makeEntry({ id: 'k-001', summary: 'Entry one', file: 'gotcha-entry-one.md' }),
      makeEntry({ id: 'k-002', summary: 'Entry two', file: 'gotcha-entry-two.md', type: 'coupling' }),
    ];
    const ranked = entries.map((e, i) => ({ entry: e, score: 1 - i * 0.1, matchReasons: [] }));
    const result = formatInjection(ranked);
    expect(result).toContain('1.');
    expect(result).toContain('2.');
    expect(result).toContain('2 relevant experience(s)');
  });

  it('respects maxTokens budget', () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeEntry({
        id: `k-${String(i + 1).padStart(3, '0')}`,
        summary: `Entry number ${i + 1} with a fairly long summary text`,
        detail: 'Some detail about the entry that is fairly long.',
        file: `gotcha-entry-${i + 1}.md`,
      })
    );
    const ranked = entries.map((e, i) => ({ entry: e, score: 1 - i * 0.05, matchReasons: [] }));
    const result = formatInjection(ranked, { maxTokens: 50 });
    // Should not include all 10 entries due to budget
    const entryCount = (result.match(/^\d+\./gm) ?? []).length;
    expect(entryCount).toBeLessThan(10);
  });
});
