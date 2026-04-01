import type { GateInput, GateResult } from './types.js';
import { loadConstraints } from './shared.js';
import { retrieveKnowledge } from '../knowledge/retriever.js';

export async function gatePreBash(projectRoot: string, input: GateInput): Promise<GateResult> {
  const command = input.command ?? '';
  if (!command) return { action: 'allow', messages: [] };

  const constraints = loadConstraints(projectRoot);
  const result: GateResult = { action: 'allow', messages: [] };

  // Check bash guard constraints
  for (const c of constraints) {
    if (!c.enforcement.hook || c.enforcement.hook_type !== 'pre_bash') continue;
    if (!c.enforcement.hook_check) continue;

    try {
      const pattern = new RegExp(c.enforcement.hook_check);
      if (pattern.test(command)) {
        const mode = c.enforcement.hook_mode ?? 'block';
        if (mode === 'block') {
          return {
            action: 'block',
            messages: [],
            blockReason: `reins [block] ${c.id}: ${c.rule}`,
          };
        } else if (mode === 'warn') {
          result.messages.push(`reins [warn] ${c.id}: ${c.rule}`);
        }
      }
    } catch {
      // Invalid regex — skip
    }
  }

  // Surface gotcha knowledge related to the command
  try {
    const knowledge = retrieveKnowledge(projectRoot, {
      prompt: command,
      maxResults: 3,
    });
    const gotchas = knowledge.filter(k => k.entry.type === 'gotcha');
    for (const g of gotchas) {
      result.messages.push(`reins [knowledge] ${g.entry.summary}`);
    }
  } catch {
    // Knowledge retrieval failure is non-fatal
  }

  return result;
}
