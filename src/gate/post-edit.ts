import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { GateInput, GateResult } from './types.js';
import { loadConstraints } from './shared.js';
import { runAstCheck } from '../ast/constraint-checker.js';

export async function gatePostEdit(projectRoot: string, input: GateInput): Promise<GateResult> {
  const filePath = input.file_path ?? input.path ?? '';
  if (!filePath) return { action: 'allow', messages: [] };

  const absPath = resolve(projectRoot, filePath);
  if (!existsSync(absPath)) return { action: 'allow', messages: [] };

  let content: string;
  try {
    content = readFileSync(absPath, 'utf-8');
  } catch {
    return { action: 'allow', messages: [] };
  }

  const constraints = loadConstraints(projectRoot);
  const result: GateResult = { action: 'allow', messages: [] };

  for (const c of constraints) {
    if (!c.enforcement.hook || c.enforcement.hook_type !== 'post_edit') continue;
    if (!c.enforcement.hook_check && !c.enforcement.ast_pattern) continue;

    // Scope check
    if (c.scope.startsWith('directory:')) {
      const dir = c.scope.replace('directory:', '');
      if (!filePath.startsWith(dir)) continue;
    }

    // Prefer AST check over regex
    if (c.enforcement.ast_pattern) {
      try {
        const astResult = await runAstCheck(c.enforcement.ast_pattern, filePath, content, c.rule);
        if (astResult !== null) {
          if (!astResult.passed) {
            const mode = c.enforcement.hook_mode ?? 'block';
            if (mode === 'block') {
              return {
                action: 'block',
                messages: [],
                blockReason: `reins [block] ${c.id}: ${astResult.violations.map(v => `L${v.line}: ${v.message}`).join('; ')}`,
              };
            } else if (mode === 'warn') {
              result.messages.push(`reins [warn] ${c.id}: ${astResult.violations.map(v => `L${v.line}: ${v.message}`).join('; ')}`);
            }
          }
          continue; // AST handled it, skip regex
        }
      } catch {
        // AST check failed, fall through to regex
      }
    }

    if (!c.enforcement.hook_check) continue;

    try {
      const pattern = new RegExp(c.enforcement.hook_check);
      if (pattern.test(content)) {
        const mode = c.enforcement.hook_mode ?? 'block';
        if (mode === 'block') {
          return {
            action: 'block',
            messages: [],
            blockReason: `reins [block] ${c.id}: ${c.rule} in ${filePath}`,
          };
        } else if (mode === 'warn') {
          result.messages.push(`reins [warn] ${c.id}: ${c.rule} in ${filePath}`);
        }
      }
    } catch {
      // Invalid regex — skip
    }
  }

  return result;
}
