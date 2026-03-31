import yaml from 'js-yaml';
import type { KnowledgeEntry, KnowledgeType } from './types.js';

const CORRECTION_KEYWORDS = [
  '不对', '别这样', '换个方式',
  'no', "don't", 'dont', 'stop', 'wrong', 'instead',
];

const CORRECTION_TEMPLATE = `The user just corrected your approach. Analyze:

1. What did you do? (briefly describe original approach)
2. What does the user expect? (briefly describe the correction)
3. What is the transferable principle?
   — Not "user said X", but "why the user is right"
   — Extract a principle that applies beyond this specific case
4. In what scope does this principle apply? (global | directory:path | file:path)

Original approach: <original_approach>
Correction: <correction>

Output format:
---
type: preference | gotcha | decision
summary: "one-sentence principle statement"
detail: "background and reasoning"
scope: "global | directory:path | file:path"
related_files: [...]
confidence: 70-95
---`;

const RETRY_TEMPLATE = `You just experienced a failed retry:
- First attempt: <first_attempt>
- Failure reason: <failure_reason>
- Successful approach: <successful_approach>

Analyze:
1. Is this failure project-specific or general?
2. What is the root cause? (not the surface error, but why the first approach was chosen)
3. How to avoid this detour next time?

Output format:
---
type: gotcha
summary: "one sentence"
detail: "root cause analysis"
related_files: [...]
confidence: 60-85
trigger_pattern: "what scenario should recall this knowledge"
---`;

const VALID_TYPES = new Set<KnowledgeType>(['coupling', 'gotcha', 'decision', 'preference']);

export function detectCorrectionSignal(message: string): boolean {
  const lower = message.toLowerCase();
  return CORRECTION_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
}

export function buildCorrectionPrompt(originalApproach: string, correction: string): string {
  return CORRECTION_TEMPLATE
    .replace('<original_approach>', originalApproach)
    .replace('<correction>', correction);
}

export function buildRetryPrompt(firstAttempt: string, failureReason: string, successfulApproach: string): string {
  return RETRY_TEMPLATE
    .replace('<first_attempt>', firstAttempt)
    .replace('<failure_reason>', failureReason)
    .replace('<successful_approach>', successfulApproach);
}

export function parseExtractorOutput(raw: string): Partial<KnowledgeEntry> | null {
  // Extract first ---...--- YAML block
  const blockRegex = /^---\s*\n([\s\S]*?)\n---/m;
  const match = blockRegex.exec(raw);
  if (!match?.[1]) return null;

  let parsed: Record<string, unknown>;
  try {
    const loaded = yaml.load(match[1]);
    if (!loaded || typeof loaded !== 'object') return null;
    parsed = loaded as Record<string, unknown>;
  } catch {
    return null;
  }

  const type = parsed['type'] as string | undefined;
  const summary = parsed['summary'] as string | undefined;
  const detail = parsed['detail'] as string | undefined;

  if (!type || !summary || !detail) return null;

  const normalizedType: KnowledgeType = VALID_TYPES.has(type as KnowledgeType)
    ? (type as KnowledgeType)
    : 'preference';

  return {
    type: normalizedType,
    summary: String(summary),
    detail: String(detail),
    scope: typeof parsed['scope'] === 'string' ? parsed['scope'] : undefined,
    related_files: Array.isArray(parsed['related_files'])
      ? (parsed['related_files'] as unknown[]).map(f => String(f))
      : [],
    confidence: typeof parsed['confidence'] === 'number' ? parsed['confidence'] : 70,
    trigger_pattern: typeof parsed['trigger_pattern'] === 'string' ? parsed['trigger_pattern'] : undefined,
  };
}
