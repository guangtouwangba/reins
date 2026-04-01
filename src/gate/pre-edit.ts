import type { GateInput, GateResult } from './types.js';
import { loadConstraints, isProtectedPath } from './shared.js';

export async function gatePreEdit(projectRoot: string, input: GateInput): Promise<GateResult> {
  const filePath = input.file_path ?? input.path ?? '';
  if (!filePath) return { action: 'allow', messages: [] };

  // Protection check
  if (isProtectedPath(filePath)) {
    return {
      action: 'block',
      messages: [],
      blockReason: `reins [block]: ${filePath} is protected by Reins. Do not modify constraint or hook files directly.`,
    };
  }

  const constraints = loadConstraints(projectRoot);
  const result: GateResult = { action: 'allow', messages: [] };

  // Check constraints against new_string content
  const content = input.new_string ?? '';
  if (!content) return result;

  for (const c of constraints) {
    if (!c.enforcement.hook || c.enforcement.hook_type !== 'post_edit') continue;
    if (!c.enforcement.hook_check) continue;

    // Scope check
    if (c.scope.startsWith('directory:')) {
      const dir = c.scope.replace('directory:', '');
      if (!filePath.startsWith(dir)) continue;
    }

    try {
      const pattern = new RegExp(c.enforcement.hook_check);
      if (pattern.test(content)) {
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
      // Invalid regex in constraint — skip
    }
  }

  return result;
}
