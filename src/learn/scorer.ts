// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillDraft {
  content: string;
  triggerPattern?: string;
  repeatCount?: number;
}

// ---------------------------------------------------------------------------
// Scoring constants
// ---------------------------------------------------------------------------

const HIGH_VALUE_KEYWORDS = [
  'error', 'fix', 'workaround', 'failed', 'avoid', 'broken', 'root cause', 'regression',
];

const GENERIC_PHRASES = [
  'try again', 'check docs', 'read the docs', 'see documentation',
];

// ---------------------------------------------------------------------------
// scoreSkillCandidate
// ---------------------------------------------------------------------------

export function scoreSkillCandidate(candidate: SkillDraft): number {
  let score = 50;

  const content = candidate.content ?? '';

  // +15: contains file paths (heuristic: forward-slash segments with an extension)
  if (/[a-zA-Z0-9_/-]+\.[a-zA-Z]{1,10}/.test(content)) {
    score += 15;
  }

  // +15: contains error messages (heuristic: "Error:", exception-like phrases, stack traces)
  if (/error:|exception|typeerror|referenceerror|cannot find|failed to|unexpected/i.test(content)) {
    score += 15;
  }

  // +5 per high-value keyword, capped at +20
  let keywordBonus = 0;
  for (const kw of HIGH_VALUE_KEYWORDS) {
    if (content.toLowerCase().includes(kw)) {
      keywordBonus += 5;
    }
  }
  score += Math.min(keywordBonus, 20);

  // +10 per repeat occurrence, capped at +30
  const repeatCount = candidate.repeatCount ?? 0;
  score += Math.min(repeatCount * 10, 30);

  // +10: solution body > 100 chars
  if (content.length > 100) {
    score += 10;
  }

  // -15: contains generic phrases
  for (const phrase of GENERIC_PHRASES) {
    if (content.toLowerCase().includes(phrase)) {
      score -= 15;
      break;
    }
  }

  // -20: content < 50 chars total
  if (content.length < 50) {
    score -= 20;
  }

  // -25: no trigger pattern defined
  if (!candidate.triggerPattern) {
    score -= 25;
  }

  return Math.max(0, Math.min(100, score));
}
