import { getLLMProvider } from '../llm/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileChange {
  path: string;
  diff?: string;
}

export interface VerificationResult {
  l0Passed: boolean;
  l1Passed: boolean;
  l2Passed: boolean;
  detail?: string;
}

export interface SemanticIssue {
  severity: 'missing' | 'incomplete' | 'excess' | 'security';
  description: string;
  relatedFiles?: string[];
}

export interface SemanticReviewResult {
  confidence: number;       // 0-100
  completeness: string;
  issues: string[];
  suggestions: string[];
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

export function buildSemanticPrompt(
  task: string,
  changedFiles: FileChange[],
  verificationResults: VerificationResult,
): string {
  const fileSection = changedFiles
    .map(f => {
      if (f.diff) {
        return `### ${f.path}\n\`\`\`diff\n${f.diff}\n\`\`\``;
      }
      return `### ${f.path}\n(no diff available)`;
    })
    .join('\n\n');

  const verSection = JSON.stringify(verificationResults, null, 2);

  return `You are a senior code reviewer performing a semantic completeness check.

## Task Requirements
${task}

## Code Changes
${fileSection || '(no changed files)'}

## Verification Results
\`\`\`json
${verSection}
\`\`\`

## Evaluation Instructions
Assess whether the code changes fully implement the task requirements. Return a JSON object with this exact shape:
{
  "confidence": <0-100 integer representing your confidence the task is complete>,
  "completeness": "<brief completeness summary>",
  "issues": ["<issue description>", ...],
  "suggestions": ["<suggestion>", ...]
}

Consider:
1. Are all requirements from the task implemented?
2. Are there missing edge cases or error handling?
3. Is there excess implementation beyond what was asked?
4. Are there security concerns?
5. Do the verification results indicate any gaps?

Respond with ONLY the JSON object, no markdown fences.`;
}

// ---------------------------------------------------------------------------
// Result parser
// ---------------------------------------------------------------------------

export function parseSemanticResult(raw: string): SemanticReviewResult {
  const fallback: SemanticReviewResult = {
    confidence: 0,
    completeness: 'parse error',
    issues: ['failed to parse LLM response'],
    suggestions: [],
  };

  // Strip markdown fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  }

  try {
    const parsed = JSON.parse(cleaned) as Partial<SemanticReviewResult>;

    const confidence =
      typeof parsed.confidence === 'number'
        ? Math.max(0, Math.min(100, Math.round(parsed.confidence)))
        : 0;

    const completeness =
      typeof parsed.completeness === 'string' ? parsed.completeness : 'unknown';

    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.filter((i): i is string => typeof i === 'string')
      : [];

    const suggestions = Array.isArray(parsed.suggestions)
      ? parsed.suggestions.filter((s): s is string => typeof s === 'string')
      : [];

    return { confidence, completeness, issues, suggestions };
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// L4 entry point (LLM call stub)
// ---------------------------------------------------------------------------

export async function runL4Semantic(
  task: string,
  changedFiles: FileChange[],
  results: VerificationResult,
): Promise<SemanticReviewResult> {
  try {
    const prompt = buildSemanticPrompt(task, changedFiles, results);
    const raw = await getLLMProvider().complete(prompt, { model: 'haiku' });
    return parseSemanticResult(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      confidence: 0,
      completeness: 'LLM call failed',
      issues: ['LLM error: ' + message],
      suggestions: [],
    };
  }
}
