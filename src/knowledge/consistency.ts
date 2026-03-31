import { dirname } from 'node:path';
import { loadKnowledgeIndex, saveKnowledgeIndex } from './staleness.js';
import type { KnowledgeIndex } from './staleness.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConsistencyReport {
  reviewed: number;
  staleMarked: number;
  entries: string[];
}

// ---------------------------------------------------------------------------
// checkSessionConsistency
// ---------------------------------------------------------------------------

export function checkSessionConsistency(
  projectRoot: string,
  modifiedFiles: string[],
): ConsistencyReport {
  const index = loadKnowledgeIndex(projectRoot);
  const report: ConsistencyReport = { reviewed: 0, staleMarked: 0, entries: [] };

  if (modifiedFiles.length === 0 || index.entries.length === 0) {
    return report;
  }

  // Normalize modified file paths (strip projectRoot prefix if present)
  const normalizedModified = modifiedFiles.map(f =>
    f.startsWith(projectRoot) ? f.slice(projectRoot.length).replace(/^\//, '') : f,
  );

  let changed = false;

  for (const entry of index.entries) {
    report.reviewed++;

    // Check if any related_files share a path or directory with modified files
    const related = entry.related_files ?? [];
    let isAffected = false;

    for (const relFile of related) {
      for (const modFile of normalizedModified) {
        if (relFile === modFile) {
          isAffected = true;
          break;
        }
        // Match if modified file is a descendant of the knowledge file's directory
        // (i.e., the knowledge dir is a proper ancestor, not just a same-level sibling)
        const relDir = dirname(relFile);
        const modDir = dirname(modFile);
        if (
          relDir !== '.' && relDir !== modDir &&
          modFile.startsWith(relDir + '/')
        ) {
          isAffected = true;
          break;
        }
        if (
          modDir !== '.' && modDir !== relDir &&
          relFile.startsWith(modDir + '/')
        ) {
          isAffected = true;
          break;
        }
      }
      if (isAffected) break;
    }

    if (isAffected) {
      entry.confidence = Math.max(0, (entry.confidence ?? 100) - 10);
      entry.needs_review = true;
      report.staleMarked++;
      report.entries.push(entry.id);
      changed = true;
    }
  }

  if (changed) {
    saveKnowledgeIndex(projectRoot, index as KnowledgeIndex);
  }

  return report;
}
