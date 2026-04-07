import type { Workflow } from './types.js';
import { setupWorkflow } from './setup.js';
import { addConstraintWorkflow } from './add-constraint.js';
import { verifyWorkflow } from './verify.js';
import { learnWorkflow } from './learn.js';
import { updateWorkflow } from './update.js';

export type { Workflow } from './types.js';

/**
 * The full set of slash commands Reins ships into a project at init time.
 *
 * Order matters for display purposes only — adapters may render them in a
 * command palette in this order. To add a new workflow, drop a file under
 * src/workflows/, import it here, and append to the array.
 */
export function getWorkflows(): Workflow[] {
  return [
    setupWorkflow,
    addConstraintWorkflow,
    verifyWorkflow,
    learnWorkflow,
    updateWorkflow,
  ];
}

/**
 * Render a workflow as a Claude Code slash command file body. Format follows
 * Claude Code's `.claude/commands/<id>.md` convention: YAML frontmatter with
 * name + description, then the markdown body.
 *
 * Other adapters (Cursor, OpenCode, …) can implement their own renderer if
 * the target tool uses a different format. We keep them tool-specific so a
 * new tool doesn't have to fit the lowest common denominator.
 */
export function renderClaudeCommand(workflow: Workflow): string {
  return `---
name: ${escapeYaml(workflow.name)}
description: ${escapeYaml(workflow.description)}
---

${workflow.body}`;
}

/**
 * Escape a string for safe single-line YAML scalar output. Quotes when the
 * value contains anything that could confuse a parser, otherwise returns it
 * unquoted to keep diffs readable.
 */
function escapeYaml(value: string): string {
  if (/[:#\n\r{}\[\],&*!|>'"%@`]|^\s|\s$/.test(value)) {
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    return `"${escaped}"`;
  }
  return value;
}
