import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import yaml from 'js-yaml';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  file: string;
  related_files: string[];
  confidence: number;
  created: string;
  last_injected?: string;
  last_validated?: string;
  needs_review?: boolean;
  injection_outcomes?: {
    success: number;
    failure: number;
  };
}

export interface KnowledgeIndex {
  version: number;
  entries: KnowledgeEntry[];
}

export interface StalenessResult {
  knowledgeId: string;
  wasStale: boolean;
  confidenceDelta: number;
  reason: string;
}

// ---------------------------------------------------------------------------
// Index helpers
// ---------------------------------------------------------------------------

export function loadKnowledgeIndex(projectRoot: string): KnowledgeIndex {
  const indexPath = join(projectRoot, '.reins', 'knowledge', 'index.yaml');
  if (!existsSync(indexPath)) {
    return { version: 1, entries: [] };
  }
  try {
    const content = readFileSync(indexPath, 'utf-8');
    const parsed = yaml.load(content) as KnowledgeIndex | null;
    if (!parsed || typeof parsed !== 'object') {
      return { version: 1, entries: [] };
    }
    return { version: parsed.version ?? 1, entries: parsed.entries ?? [] };
  } catch {
    return { version: 1, entries: [] };
  }
}

export function saveKnowledgeIndex(projectRoot: string, index: KnowledgeIndex): void {
  const dir = join(projectRoot, '.reins', 'knowledge');
  mkdirSync(dir, { recursive: true });
  const indexPath = join(dir, 'index.yaml');
  writeFileSync(indexPath, yaml.dump(index), 'utf-8');
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function getFileChangeRatio(projectRoot: string, filePath: string, sinceDate: string): number | null {
  try {
    // Get total line count of file
    const fullPath = join(projectRoot, filePath);
    if (!existsSync(fullPath)) return null; // file deleted

    const content = readFileSync(fullPath, 'utf-8');
    const totalLines = content.split('\n').length;
    if (totalLines === 0) return 0;

    // Get diff stat since created date
    const diffOutput = execSync(
      `git diff --stat "${sinceDate}"..HEAD -- "${filePath}"`,
      { cwd: projectRoot, encoding: 'utf-8', timeout: 10_000 },
    );

    // Parse insertions/deletions from diff stat output
    // Format: " 1 file changed, X insertions(+), Y deletions(-)"
    const insertMatch = diffOutput.match(/(\d+) insertion/);
    const deleteMatch = diffOutput.match(/(\d+) deletion/);
    const insertions = insertMatch ? parseInt(insertMatch[1] ?? '0', 10) : 0;
    const deletions = deleteMatch ? parseInt(deleteMatch[1] ?? '0', 10) : 0;
    const changed = insertions + deletions;

    return changed / Math.max(totalLines, 1);
  } catch {
    return 0;
  }
}

function isFileDeleted(projectRoot: string, filePath: string): boolean {
  return !existsSync(join(projectRoot, filePath));
}

// ---------------------------------------------------------------------------
// checkStaleness
// ---------------------------------------------------------------------------

export async function checkStaleness(
  projectRoot: string,
  entry: KnowledgeEntry,
): Promise<StalenessResult> {
  let confidenceDelta = 0;
  const reasons: string[] = [];
  let wasStale = false;

  for (const relFile of entry.related_files) {
    if (isFileDeleted(projectRoot, relFile)) {
      confidenceDelta -= 20;
      reasons.push(`file deleted: ${relFile}`);
      wasStale = true;
      continue;
    }

    const ratio = getFileChangeRatio(projectRoot, relFile, entry.created);
    if (ratio !== null && ratio > 0.3) {
      confidenceDelta -= 20;
      reasons.push(`${relFile} changed ${Math.round(ratio * 100)}%`);
      wasStale = true;
    }
  }

  // Unused decay: last_injected > 60 days ago
  if (entry.last_injected) {
    const lastInjected = new Date(entry.last_injected).getTime();
    const now = Date.now();
    const daysSince = (now - lastInjected) / (1000 * 60 * 60 * 24);
    if (daysSince > 60) {
      confidenceDelta -= 10;
      reasons.push('unused 60+ days');
      wasStale = true;
    }
  }

  return {
    knowledgeId: entry.id,
    wasStale,
    confidenceDelta,
    reason: reasons.join('; ') || 'no staleness detected',
  };
}

// ---------------------------------------------------------------------------
// runStalenessPass
// ---------------------------------------------------------------------------

export async function runStalenessPass(projectRoot: string): Promise<StalenessResult[]> {
  const index = loadKnowledgeIndex(projectRoot);
  if (index.entries.length === 0) return [];

  const results: StalenessResult[] = [];
  let changed = false;

  for (const entry of index.entries) {
    const result = await checkStaleness(projectRoot, entry);
    results.push(result);

    if (result.wasStale && result.confidenceDelta !== 0) {
      entry.confidence = Math.max(0, Math.min(100, entry.confidence + result.confidenceDelta));
      entry.needs_review = true;
      changed = true;
    }
  }

  if (changed) {
    saveKnowledgeIndex(projectRoot, index);

    // Call archiver after staleness mutations
    const { enforceCapacity } = await import('./archiver.js');
    enforceCapacity(projectRoot);
  }

  return results;
}
