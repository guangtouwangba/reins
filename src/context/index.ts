import { generateL0 } from './l0-generator.js';
import { generateL1, buildDirectoryProfiles } from './l1-generator.js';
import { generateL2 } from './l2-generator.js';
import type { CodebaseContext } from '../scanner/types.js';
import type { Constraint } from '../constraints/schema.js';

export { generateL0 } from './l0-generator.js';
export { generateL1, buildDirectoryProfiles } from './l1-generator.js';
export type { DirectoryProfile } from './l1-generator.js';
export { generateL2, groupConstraintsByTopic } from './l2-generator.js';

export interface GenerateContextResult {
  l0Written: boolean;
  l1Files: string[];
  l2Files: string[];
}

/**
 * Unified entry point for context generation.
 *
 * @param projectRoot - Absolute path to project root
 * @param constraints - Full constraint list
 * @param context     - Scanned codebase context
 * @param depth       - One of: 'L0', 'L0-L1', 'L0-L2'
 */
export function generateContext(
  projectRoot: string,
  constraints: Constraint[],
  context: CodebaseContext,
  depth: string,
): GenerateContextResult {
  // L0 always runs
  generateL0(projectRoot, context, constraints);

  const l1Files: string[] = [];
  const l2Files: string[] = [];

  const includeL1 = depth === 'L0-L1' || depth === 'L0-L2';
  const includeL2 = depth === 'L0-L2';

  if (includeL1) {
    const profiles = buildDirectoryProfiles(context, constraints);
    generateL1(projectRoot, constraints, profiles);
    l1Files.push(...profiles.map(p => `${p.path}/AGENTS.md`));
  }

  if (includeL2) {
    generateL2(projectRoot, constraints, context);
    const helpful = constraints.filter(c => c.severity === 'helpful');
    // Infer which topic files would be written (same logic as generateL2)
    const topics = new Set<string>();
    const TOPIC_RULES: Array<{ pattern: RegExp; topic: string }> = [
      { pattern: /api|route|endpoint/i, topic: 'api-patterns' },
      { pattern: /test|coverage|fixture/i, topic: 'testing-patterns' },
      { pattern: /error|exception|throw/i, topic: 'error-handling' },
      { pattern: /import|module|depend/i, topic: 'module-patterns' },
    ];
    for (const c of helpful) {
      let assigned = false;
      for (const { pattern, topic } of TOPIC_RULES) {
        if (pattern.test(c.rule)) {
          topics.add(topic);
          assigned = true;
          break;
        }
      }
      if (!assigned) topics.add('general-patterns');
    }
    l2Files.push(...Array.from(topics).map(t => `.reins/patterns/${t}.md`));
  }

  return { l0Written: true, l1Files, l2Files };
}
