import type { GateInput, GateResult } from './types.js';
import { loadConstraints } from './shared.js';
import { retrieveKnowledge } from '../knowledge/retriever.js';
import { formatInjection } from '../knowledge/injector.js';
import { loadProjectIndex } from '../ast/project-index.js';
import { queryImportStyle } from '../ast/project-query.js';

export async function gateContext(projectRoot: string, input: GateInput): Promise<GateResult> {
  const prompt = input.prompt ?? '';
  if (!prompt) return { action: 'allow', messages: [] };

  const constraints = loadConstraints(projectRoot);
  const messages: string[] = [];

  // 1. Constraint summary (critical + important)
  const relevant = constraints.filter(c =>
    c.severity === 'critical' || c.severity === 'important'
  );
  if (relevant.length > 0) {
    messages.push('[Reins Constraints]');
    for (const c of relevant) {
      messages.push(`  - [${c.severity}] ${c.rule}`);
    }
  }

  // 2. Knowledge retrieval
  try {
    const knowledge = retrieveKnowledge(projectRoot, {
      prompt,
      maxResults: 5,
    });
    if (knowledge.length > 0) {
      const injectionText = formatInjection(knowledge, { maxTokens: 1000 });
      if (injectionText) {
        messages.push('');
        messages.push(injectionText);
      }
    }
  } catch {
    // Knowledge retrieval failure is non-fatal
  }

  // 3. Code profile from AST index
  try {
    const index = loadProjectIndex(projectRoot);
    if (index && index.aggregated.totalFiles > 0) {
      const agg = index.aggregated;
      const langs = Object.entries(agg.languageBreakdown)
        .sort((a, b) => b[1] - a[1])
        .map(([lang, count]) => `${count} ${lang}`)
        .join(', ');
      const { dominant } = queryImportStyle(index);
      const namingEntries = Object.entries(agg.namingStyle);
      const dominantNaming = namingEntries.length > 0
        ? namingEntries.sort((a, b) => b[1] - a[1])[0]![0]
        : 'unknown';
      messages.push('');
      messages.push(`[Reins Code Profile] ${langs} | imports: ${dominant} | naming: ${dominantNaming}`);
    }
  } catch {
    // Code profile is non-critical
  }

  return { action: 'allow', messages };
}
