import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import yaml from 'js-yaml';
import { loadKnowledgeIndex, saveKnowledgeIndex } from './staleness.js';
import type { KnowledgeEntry, KnowledgeIndex } from './staleness.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArchivedEntry extends KnowledgeEntry {
  archived_at: string;
}

export interface ArchiveResult {
  archived: string[];
  evicted: string[];
}

// ---------------------------------------------------------------------------
// Archive index helpers
// ---------------------------------------------------------------------------

function loadArchiveIndex(projectRoot: string): { version: number; entries: ArchivedEntry[] } {
  const archivePath = join(projectRoot, '.reins', 'knowledge', 'archive', 'index.yaml');
  if (!existsSync(archivePath)) {
    return { version: 1, entries: [] };
  }
  try {
    const content = readFileSync(archivePath, 'utf-8');
    const parsed = yaml.load(content) as { version: number; entries: ArchivedEntry[] } | null;
    if (!parsed || typeof parsed !== 'object') return { version: 1, entries: [] };
    return { version: parsed.version ?? 1, entries: parsed.entries ?? [] };
  } catch {
    return { version: 1, entries: [] };
  }
}

function saveArchiveIndex(
  projectRoot: string,
  archiveIndex: { version: number; entries: ArchivedEntry[] },
): void {
  const archiveDir = join(projectRoot, '.reins', 'knowledge', 'archive');
  mkdirSync(archiveDir, { recursive: true });
  writeFileSync(join(archiveDir, 'index.yaml'), yaml.dump(archiveIndex), 'utf-8');
}

// ---------------------------------------------------------------------------
// archiveEntry
// ---------------------------------------------------------------------------

export function archiveEntry(projectRoot: string, knowledgeId: string): void {
  const index = loadKnowledgeIndex(projectRoot);
  const entryIdx = index.entries.findIndex((e: KnowledgeEntry) => e.id === knowledgeId);
  if (entryIdx === -1) return;

  const entry = index.entries[entryIdx] as KnowledgeEntry;

  // Move markdown file if it exists
  if (entry.file) {
    const srcPath = join(projectRoot, '.reins', 'knowledge', entry.file);
    if (existsSync(srcPath)) {
      const destDir = join(projectRoot, '.reins', 'knowledge', 'archive');
      mkdirSync(destDir, { recursive: true });
      const destPath = join(destDir, entry.file);
      // Ensure dest subdirectory exists
      mkdirSync(dirname(destPath), { recursive: true });
      try {
        renameSync(srcPath, destPath);
      } catch {
        // best effort — file may not exist
      }
    }
  }

  // Remove from active index
  index.entries.splice(entryIdx, 1);
  saveKnowledgeIndex(projectRoot, index);

  // Append to archive index
  const archiveIndex = loadArchiveIndex(projectRoot);
  const archived: ArchivedEntry = { ...entry, archived_at: new Date().toISOString() };
  archiveIndex.entries.push(archived);
  saveArchiveIndex(projectRoot, archiveIndex);
}

// ---------------------------------------------------------------------------
// enforceCapacity
// ---------------------------------------------------------------------------

export function enforceCapacity(
  projectRoot: string,
  config?: {
    max_per_directory?: number;
    max_global?: number;
    min_confidence?: number;
  },
): ArchiveResult {
  const maxPerDirectory = config?.max_per_directory ?? 10;
  const maxGlobal = config?.max_global ?? 100;
  const minConfidence = config?.min_confidence ?? 20;

  const archived: string[] = [];
  const evicted: string[] = [];

  // Pass 1: min-confidence sweep
  {
    const index = loadKnowledgeIndex(projectRoot);
    const toArchive = index.entries
      .filter((e: KnowledgeEntry) => e.confidence < minConfidence)
      .map((e: KnowledgeEntry) => e.id);
    for (const id of toArchive) {
      archiveEntry(projectRoot, id);
      archived.push(id);
    }
  }

  // Pass 2: per-directory limit
  {
    const index = loadKnowledgeIndex(projectRoot);

    // Group entries by first directory of related_files
    const byDir = new Map<string, KnowledgeEntry[]>();
    for (const entry of index.entries) {
      const dirs = new Set<string>();
      for (const f of entry.related_files ?? []) {
        const parts = f.split('/');
        dirs.add(parts[0] ?? '.');
      }
      if (dirs.size === 0) dirs.add('.');
      for (const dir of dirs) {
        if (!byDir.has(dir)) byDir.set(dir, []);
        byDir.get(dir)!.push(entry);
      }
    }

    for (const [, entries] of byDir) {
      if (entries.length > maxPerDirectory) {
        // Sort by confidence ascending, archive the excess
        const sorted = [...entries].sort((a, b) => a.confidence - b.confidence);
        const excess = sorted.slice(0, entries.length - maxPerDirectory);
        for (const entry of excess) {
          // Re-check: may have been archived in a prior iteration
          const current = loadKnowledgeIndex(projectRoot);
          if (current.entries.some((e: KnowledgeEntry) => e.id === entry.id)) {
            archiveEntry(projectRoot, entry.id);
            evicted.push(entry.id);
          }
        }
      }
    }
  }

  // Pass 3: global limit
  {
    const index = loadKnowledgeIndex(projectRoot);
    if (index.entries.length > maxGlobal) {
      const sorted = [...index.entries].sort(
        (a: KnowledgeEntry, b: KnowledgeEntry) => a.confidence - b.confidence,
      );
      const excess = sorted.slice(0, index.entries.length - maxGlobal);
      for (const entry of excess) {
        const current = loadKnowledgeIndex(projectRoot);
        if (current.entries.some((e: KnowledgeEntry) => e.id === entry.id)) {
          archiveEntry(projectRoot, entry.id);
          evicted.push(entry.id);
        }
      }
    }
  }

  return { archived, evicted };
}
