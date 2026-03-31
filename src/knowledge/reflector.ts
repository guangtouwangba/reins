import yaml from 'js-yaml';
import type { KnowledgeEntry, KnowledgeType } from './types.js';

const REFLECTION_TEMPLATE = `
You just completed the task: <task_description>

Answer only the questions where you have substantive content. Skip the rest.

1. [coupling] What non-obvious module coupling or shared state did you discover?
   (Modifying A broke B, A and B share some hidden state)

2. [gotcha] What traps did you fall into? What dead ends did you take?
   (Why the first attempt failed, unexpected behavior)

3. [decision] What non-trivial technical decisions did you make, and why?
   (Why you chose approach A over B, what you traded off)

4. [heuristic] If you did a similar task again, what would you want to know upfront?
   (Key information that would make next time faster)

Output each answer as a YAML block:
---
type: coupling | gotcha | decision | preference
summary: "one-sentence summary"
detail: "2-3 sentence explanation"
related_files:
  - "path/to/file.ts"
confidence: 60-100
---
`;

const VALID_TYPES = new Set<KnowledgeType>(['coupling', 'gotcha', 'decision', 'preference']);

export function buildReflectionPrompt(taskDescription: string): string {
  return REFLECTION_TEMPLATE.replace('<task_description>', taskDescription);
}

export function parseReflectionOutput(raw: string): Partial<KnowledgeEntry>[] {
  const results: Partial<KnowledgeEntry>[] = [];

  // Extract all ---...--- YAML blocks
  const blockRegex = /^---\s*\n([\s\S]*?)\n---/gm;
  let match;

  while ((match = blockRegex.exec(raw)) !== null) {
    const blockContent = match[1];
    if (!blockContent) continue;

    let parsed: Record<string, unknown>;
    try {
      const loaded = yaml.load(blockContent);
      if (!loaded || typeof loaded !== 'object') continue;
      parsed = loaded as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = parsed['type'] as string | undefined;
    const summary = parsed['summary'] as string | undefined;
    const detail = parsed['detail'] as string | undefined;

    // Must have type, summary, detail
    if (!type || !summary || !detail) continue;

    // Normalize type: 'heuristic' maps to 'preference'
    let normalizedType: KnowledgeType;
    if (type === 'heuristic') {
      normalizedType = 'preference';
    } else if (VALID_TYPES.has(type as KnowledgeType)) {
      normalizedType = type as KnowledgeType;
    } else {
      normalizedType = 'preference';
    }

    const entry: Partial<KnowledgeEntry> = {
      type: normalizedType,
      summary: String(summary),
      detail: String(detail),
      related_files: Array.isArray(parsed['related_files'])
        ? (parsed['related_files'] as unknown[]).map(f => String(f))
        : [],
      confidence: typeof parsed['confidence'] === 'number' ? parsed['confidence'] : 70,
    };

    results.push(entry);
  }

  return results;
}
