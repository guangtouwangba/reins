import type { CodebaseContext } from '../scanner/types.js';
import type { Constraint } from '../constraints/schema.js';
import { generateQuestions } from './question-engine.js';
import { generateSpec } from './spec-generator.js';
import { createSpecDir, writeSpecFile, updateSpecStatus } from '../state/specs.js';

export interface RefineOptions {
  noInput?: boolean;
}

/** Orchestrate the requirement refinement flow:
 *  1. Generate questions (3-layer engine)
 *  2. Display inferred facts
 *  3. Prompt user for blocking+important questions (or use defaults in noInput mode)
 *  4. Generate spec from answers
 *  5. Write spec.md and update index */
export async function refineRequirements(
  task: string,
  context: CodebaseContext,
  constraints: Constraint[],
  projectRoot: string,
  opts?: RefineOptions,
): Promise<string> {
  // Step 1: Generate questions
  const categorized = await generateQuestions(task, context, constraints);

  // Step 2: Display inferred facts
  if (categorized.inferred.length > 0) {
    console.log('');
    console.log('Based on your project, I already know:');
    for (const fact of categorized.inferred) {
      console.log(`  • ${fact.dimension}: ${fact.fact} (${fact.source})`);
    }
    console.log('');
  }

  // Step 3: Collect answers
  const answers: Record<string, string> = {};

  if (opts?.noInput) {
    // Non-interactive: use defaults for everything
    for (const q of [...categorized.blocking, ...categorized.important, ...categorized.optional]) {
      answers[q.id] = q.default ?? 'As described in the task';
    }
  } else {
    // In interactive mode, we'd prompt with readline.
    // For now, use defaults (real prompting requires TTY detection).
    for (const q of [...categorized.blocking, ...categorized.important]) {
      answers[q.id] = q.default ?? 'As described in the task';
    }
    for (const q of categorized.optional) {
      answers[q.id] = q.default ?? 'Standard behavior';
    }
  }

  // Step 4: Generate spec
  const specContent = await generateSpec({ task, answers, inferred: categorized.inferred, constraints });

  // Step 5: Create spec directory and write
  const specId = createSpecDir(projectRoot, task);
  writeSpecFile(projectRoot, specId, 'spec.md', specContent);
  updateSpecStatus(projectRoot, specId, 'confirmed');

  console.log(`Spec saved to .reins/specs/${specId}/spec.md`);

  return specId;
}
