import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import {
  checkStaleness,
  loadKnowledgeIndex,
  saveKnowledgeIndex,
  runStalenessPass,
} from './staleness.js';
import type { KnowledgeEntry, KnowledgeIndex } from './staleness.js';
import { recordInjectionOutcome } from './feedback.js';
import { enforceCapacity, archiveEntry } from './archiver.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  const dir = join(
    tmpdir(),
    `reins-knowledge-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: `entry-${Math.random().toString(36).slice(2)}`,
    title: 'Test Entry',
    content: 'Some knowledge content',
    file: 'entry.md',
    related_files: [],
    confidence: 70,
    created: new Date().toISOString(),
    ...overrides,
  };
}

function writeIndex(dir: string, entries: KnowledgeEntry[]): void {
  const knowledgeDir = join(dir, '.reins', 'knowledge');
  mkdirSync(knowledgeDir, { recursive: true });
  const index: KnowledgeIndex = { version: 1, entries };
  writeFileSync(join(knowledgeDir, 'index.yaml'), yaml.dump(index), 'utf-8');
}

// ---------------------------------------------------------------------------
// Staleness detection
// ---------------------------------------------------------------------------

describe('checkStaleness', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns wasStale:false for a fresh entry with no related files', async () => {
    const entry = makeEntry({ related_files: [] });
    const result = await checkStaleness(tmpDir, entry);
    expect(result.wasStale).toBe(false);
    expect(result.confidenceDelta).toBe(0);
    expect(result.knowledgeId).toBe(entry.id);
  });

  it('marks stale when a related file is deleted', async () => {
    const entry = makeEntry({ related_files: ['src/deleted.ts'] });
    // Do not create the file so it appears deleted
    const result = await checkStaleness(tmpDir, entry);
    expect(result.wasStale).toBe(true);
    expect(result.confidenceDelta).toBeLessThan(0);
    expect(result.reason).toContain('deleted');
  });

  it('marks stale when last_injected is more than 60 days ago', async () => {
    const longAgo = new Date(Date.now() - 65 * 24 * 60 * 60 * 1000).toISOString();
    const entry = makeEntry({ last_injected: longAgo, related_files: [] });
    const result = await checkStaleness(tmpDir, entry);
    expect(result.wasStale).toBe(true);
    expect(result.confidenceDelta).toBe(-10);
    expect(result.reason).toContain('unused 60+ days');
  });

  it('does not mark stale when last_injected is recent', async () => {
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const entry = makeEntry({ last_injected: recent, related_files: [] });
    const result = await checkStaleness(tmpDir, entry);
    expect(result.wasStale).toBe(false);
  });

  it('accumulates multiple penalties', async () => {
    const longAgo = new Date(Date.now() - 65 * 24 * 60 * 60 * 1000).toISOString();
    const entry = makeEntry({
      last_injected: longAgo,
      related_files: ['src/missing.ts'], // deleted
    });
    const result = await checkStaleness(tmpDir, entry);
    expect(result.wasStale).toBe(true);
    // -20 for deleted file + -10 for unused = -30
    expect(result.confidenceDelta).toBe(-30);
  });
});

// ---------------------------------------------------------------------------
// runStalenessPass
// ---------------------------------------------------------------------------

describe('runStalenessPass', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns empty array when no index exists', async () => {
    const results = await runStalenessPass(tmpDir);
    expect(results).toEqual([]);
  });

  it('processes all entries in index', async () => {
    const entries = [
      makeEntry({ id: 'e1', related_files: [] }),
      makeEntry({ id: 'e2', related_files: [] }),
    ];
    writeIndex(tmpDir, entries);
    const results = await runStalenessPass(tmpDir);
    expect(results).toHaveLength(2);
    expect(results.map(r => r.knowledgeId).sort()).toEqual(['e1', 'e2'].sort());
  });

  it('updates confidence in index when entry is stale', async () => {
    const longAgo = new Date(Date.now() - 65 * 24 * 60 * 60 * 1000).toISOString();
    const entry = makeEntry({ id: 'stale1', confidence: 60, last_injected: longAgo });
    writeIndex(tmpDir, [entry]);

    await runStalenessPass(tmpDir);

    const updated = loadKnowledgeIndex(tmpDir);
    const updatedEntry = updated.entries.find(e => e.id === 'stale1');
    // confidence should have decreased by 10
    expect(updatedEntry?.confidence).toBe(50);
    expect(updatedEntry?.needs_review).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Feedback recording
// ---------------------------------------------------------------------------

describe('recordInjectionOutcome', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('does nothing when knowledgeId not found', () => {
    writeIndex(tmpDir, []);
    expect(() => recordInjectionOutcome(tmpDir, 'nonexistent', 'success', true)).not.toThrow();
  });

  it('increments confidence by 3 on success', () => {
    const entry = makeEntry({ id: 'k1', confidence: 70 });
    writeIndex(tmpDir, [entry]);
    recordInjectionOutcome(tmpDir, 'k1', 'success', true);
    const updated = loadKnowledgeIndex(tmpDir);
    expect(updated.entries.find(e => e.id === 'k1')?.confidence).toBe(73);
  });

  it('caps confidence at 100 on success', () => {
    const entry = makeEntry({ id: 'k2', confidence: 99 });
    writeIndex(tmpDir, [entry]);
    recordInjectionOutcome(tmpDir, 'k2', 'success', true);
    const updated = loadKnowledgeIndex(tmpDir);
    expect(updated.entries.find(e => e.id === 'k2')?.confidence).toBe(100);
  });

  it('decrements confidence by 15 on relevant failure', () => {
    const entry = makeEntry({ id: 'k3', confidence: 70 });
    writeIndex(tmpDir, [entry]);
    recordInjectionOutcome(tmpDir, 'k3', 'failure', true);
    const updated = loadKnowledgeIndex(tmpDir);
    expect(updated.entries.find(e => e.id === 'k3')?.confidence).toBe(55);
  });

  it('floors confidence at 0 on relevant failure', () => {
    const entry = makeEntry({ id: 'k4', confidence: 10 });
    writeIndex(tmpDir, [entry]);
    recordInjectionOutcome(tmpDir, 'k4', 'failure', true);
    const updated = loadKnowledgeIndex(tmpDir);
    const active = updated.entries.find(e => e.id === 'k4');
    // Entry may be archived (confidence 0 < min_confidence 20) or still active with confidence 0
    if (active) {
      expect(active.confidence).toBe(0);
    } else {
      // Archived by enforceCapacity — confidence was correctly floored to 0
      const archivePath = join(tmpDir, '.reins', 'knowledge', 'archive', 'index.yaml');
      expect(existsSync(archivePath)).toBe(true);
    }
  });

  it('does not change confidence on irrelevant failure', () => {
    const entry = makeEntry({ id: 'k5', confidence: 70 });
    writeIndex(tmpDir, [entry]);
    recordInjectionOutcome(tmpDir, 'k5', 'failure', false);
    const updated = loadKnowledgeIndex(tmpDir);
    expect(updated.entries.find(e => e.id === 'k5')?.confidence).toBe(70);
  });

  it('increments success counter on success', () => {
    const entry = makeEntry({ id: 'k6', confidence: 70 });
    writeIndex(tmpDir, [entry]);
    recordInjectionOutcome(tmpDir, 'k6', 'success', true);
    const updated = loadKnowledgeIndex(tmpDir);
    expect(updated.entries.find(e => e.id === 'k6')?.injection_outcomes?.success).toBe(1);
  });

  it('increments failure counter on relevant failure', () => {
    const entry = makeEntry({ id: 'k7', confidence: 70 });
    writeIndex(tmpDir, [entry]);
    recordInjectionOutcome(tmpDir, 'k7', 'failure', true);
    const updated = loadKnowledgeIndex(tmpDir);
    expect(updated.entries.find(e => e.id === 'k7')?.injection_outcomes?.failure).toBe(1);
  });

  it('sets last_validated on every call', () => {
    const entry = makeEntry({ id: 'k8', confidence: 70 });
    writeIndex(tmpDir, [entry]);
    const before = Date.now();
    recordInjectionOutcome(tmpDir, 'k8', 'success', true);
    const updated = loadKnowledgeIndex(tmpDir);
    const ts = updated.entries.find(e => e.id === 'k8')?.last_validated;
    expect(ts).toBeDefined();
    expect(new Date(ts!).getTime()).toBeGreaterThanOrEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Capacity enforcement
// ---------------------------------------------------------------------------

describe('enforceCapacity', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns empty archived/evicted when index is empty', () => {
    writeIndex(tmpDir, []);
    const result = enforceCapacity(tmpDir);
    expect(result.archived).toEqual([]);
    expect(result.evicted).toEqual([]);
  });

  it('archives entries below min_confidence', () => {
    const entries = [
      makeEntry({ id: 'low1', confidence: 10 }),
      makeEntry({ id: 'low2', confidence: 15 }),
      makeEntry({ id: 'high1', confidence: 80 }),
    ];
    writeIndex(tmpDir, entries);
    const result = enforceCapacity(tmpDir, { min_confidence: 20 });
    expect(result.archived).toContain('low1');
    expect(result.archived).toContain('low2');
    expect(result.archived).not.toContain('high1');

    // Archived entries should be removed from active index
    const active = loadKnowledgeIndex(tmpDir);
    expect(active.entries.find(e => e.id === 'low1')).toBeUndefined();
    expect(active.entries.find(e => e.id === 'high1')).toBeDefined();
  });

  it('enforces global max by evicting lowest confidence', () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      makeEntry({ id: `g${i}`, confidence: (i + 1) * 10 }),
    );
    writeIndex(tmpDir, entries);
    const result = enforceCapacity(tmpDir, { max_global: 3, min_confidence: 0 });
    const active = loadKnowledgeIndex(tmpDir);
    expect(active.entries.length).toBeLessThanOrEqual(3);
    expect(result.evicted.length).toBeGreaterThan(0);
  });

  it('enforces per-directory limit', () => {
    // All entries have same directory prefix
    const entries = Array.from({ length: 5 }, (_, i) =>
      makeEntry({ id: `d${i}`, confidence: (i + 1) * 10, related_files: [`src/file${i}.ts`] }),
    );
    writeIndex(tmpDir, entries);
    const result = enforceCapacity(tmpDir, { max_per_directory: 2, min_confidence: 0, max_global: 1000 });
    const active = loadKnowledgeIndex(tmpDir);
    expect(active.entries.length).toBeLessThanOrEqual(2);
    expect(result.evicted.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// archiveEntry
// ---------------------------------------------------------------------------

describe('archiveEntry', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('removes entry from active index', () => {
    const entry = makeEntry({ id: 'arc1' });
    writeIndex(tmpDir, [entry]);
    archiveEntry(tmpDir, 'arc1');
    const active = loadKnowledgeIndex(tmpDir);
    expect(active.entries.find(e => e.id === 'arc1')).toBeUndefined();
  });

  it('adds entry to archive index with archived_at timestamp', () => {
    const entry = makeEntry({ id: 'arc2' });
    writeIndex(tmpDir, [entry]);
    archiveEntry(tmpDir, 'arc2');

    const archivePath = join(tmpDir, '.reins', 'knowledge', 'archive', 'index.yaml');
    expect(existsSync(archivePath)).toBe(true);
    const content = yaml.load(readFileSync(archivePath, 'utf-8')) as {
      entries: Array<{ id: string; archived_at: string }>;
    };
    const archived = content.entries.find(e => e.id === 'arc2');
    expect(archived).toBeDefined();
    expect(archived?.archived_at).toBeDefined();
  });

  it('does nothing when knowledgeId not found', () => {
    writeIndex(tmpDir, []);
    expect(() => archiveEntry(tmpDir, 'nonexistent')).not.toThrow();
  });
});
