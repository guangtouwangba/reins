import type { RankedEntry } from './retriever.js';

const MAX_TOKENS_DEFAULT = 200;
// Rough token estimate: 1 token ~ 4 chars
const CHARS_PER_TOKEN = 4;

export function formatInjection(entries: RankedEntry[], options?: { maxTokens?: number }): string {
  if (entries.length === 0) return '';

  const maxTokens = options?.maxTokens ?? MAX_TOKENS_DEFAULT;
  const maxChars = maxTokens * CHARS_PER_TOKEN;

  const lines: string[] = [`[Reins Knowledge] ${entries.length} relevant experience(s) for this task:`, ''];

  let totalChars = lines.join('\n').length;

  for (let i = 0; i < entries.length; i++) {
    const { entry } = entries[i]!;

    // First sentence of detail as implication
    const detailFirstSentence = entry.detail.split(/[.!?]/)[0]?.trim() ?? entry.detail;

    const entryLines = [
      `${i + 1}. [${entry.type}] ${entry.summary}`,
      `   → ${detailFirstSentence}`,
      `   → Details: .reins/knowledge/${entry.file}`,
    ];

    const entryText = entryLines.join('\n');
    if (totalChars + entryText.length + 2 > maxChars && i > 0) {
      // Budget exceeded — stop adding entries (but always include at least one)
      break;
    }

    lines.push(...entryLines);
    lines.push('');
    totalChars += entryText.length + 2;
  }

  // Remove trailing empty line
  while (lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines.join('\n');
}
