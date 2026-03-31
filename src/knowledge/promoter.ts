import type { KnowledgeEntry } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromotionCandidate {
  knowledge: KnowledgeEntry;
  targetType: 'constraint' | 'skill' | 'l1_addition';
  reason: string;
}

export interface DemotionSuggestion {
  rule: string;
  bypassCount: number;
  successRate: number;
  suggestion: 'downgrade_to_preference';
}

export interface BypassEvent {
  rule: string;
  timestamp: string;
  outcome: 'success' | 'failure';
}

// ---------------------------------------------------------------------------
// checkPromotion
// ---------------------------------------------------------------------------

export function checkPromotion(entry: KnowledgeEntry): PromotionCandidate | null {
  // Guard 1: confidence must be >= 90
  if (entry.confidence < 90) return null;

  // Guard 2: success count must be >= 5
  const successCount = entry.injection_outcomes?.success ?? 0;
  if (successCount < 5) return null;

  // Guard 3: success rate must be >= 80%
  const failureCount = entry.injection_outcomes?.failure ?? 0;
  const total = successCount + failureCount;
  const successRate = total > 0 ? successCount / total : 0;
  if (successRate < 0.8) return null;

  // Target type routing
  let targetType: PromotionCandidate['targetType'];
  switch (entry.type) {
    case 'preference':
    case 'coupling':
      targetType = 'constraint';
      break;
    case 'gotcha':
      targetType = 'skill';
      break;
    case 'decision':
      targetType = 'l1_addition';
      break;
    default:
      targetType = 'constraint';
  }

  const reason =
    `Validated ${successCount} times with ${Math.round(successRate * 100)}% success rate` +
    ` (confidence: ${entry.confidence})`;

  return { knowledge: entry, targetType, reason };
}

// ---------------------------------------------------------------------------
// evaluatePromotions
// ---------------------------------------------------------------------------

export function evaluatePromotions(entries: KnowledgeEntry[]): PromotionCandidate[] {
  const candidates: PromotionCandidate[] = [];
  for (const entry of entries) {
    const candidate = checkPromotion(entry);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// checkDemotion
// ---------------------------------------------------------------------------

export function checkDemotion(
  rule: string,
  bypassLog: BypassEvent[],
): DemotionSuggestion | null {
  const relevant = bypassLog.filter(e => e.rule === rule);
  if (relevant.length <= 5) return null;

  const successAfterBypass = relevant.filter(e => e.outcome === 'success').length;
  const successRate = successAfterBypass / relevant.length;

  if (successRate <= 0.9) return null;

  return {
    rule,
    bypassCount: relevant.length,
    successRate,
    suggestion: 'downgrade_to_preference',
  };
}
