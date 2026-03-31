import { loadKnowledgeIndex, saveKnowledgeIndex } from './staleness.js';
import type { KnowledgeEntry } from './staleness.js';
import { enforceCapacity } from './archiver.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FeedbackRecord {
  knowledgeId: string;
  taskOutcome: 'success' | 'failure';
  relevant: boolean;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// recordInjectionOutcome
// ---------------------------------------------------------------------------

export function recordInjectionOutcome(
  projectRoot: string,
  knowledgeId: string,
  taskOutcome: 'success' | 'failure',
  relevant: boolean,
): void {
  const index = loadKnowledgeIndex(projectRoot);
  const entry = index.entries.find((e: KnowledgeEntry) => e.id === knowledgeId);

  if (!entry) return;

  // Initialize injection_outcomes if absent
  if (!entry.injection_outcomes) {
    entry.injection_outcomes = { success: 0, failure: 0 };
  }

  if (taskOutcome === 'success') {
    entry.confidence = Math.min(100, entry.confidence + 3);
    entry.injection_outcomes.success += 1;
  } else if (taskOutcome === 'failure' && relevant) {
    entry.confidence = Math.max(0, entry.confidence - 15);
    entry.injection_outcomes.failure += 1;
  }
  // failure && !relevant: no confidence change, no counter update

  entry.last_validated = new Date().toISOString();

  saveKnowledgeIndex(projectRoot, index);

  // Enforce capacity after every confidence mutation
  enforceCapacity(projectRoot);
}
