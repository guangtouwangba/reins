import type { Constraint } from '../constraints/schema.js';
import type { InferredFact } from './question-engine.js';

export interface SpecInput {
  task: string;
  answers: Record<string, string>;
  inferred: InferredFact[];
  constraints: Constraint[];
}

/** Generate a spec.md document from task + answers + inferred facts + constraints.
 *  In production, this uses an LLM (sonnet) to flesh out the template.
 *  This implementation generates a structured template from the raw inputs. */
export async function generateSpec(input: SpecInput): Promise<string> {
  const { task, answers, inferred, constraints } = input;

  const decisionsRows = [
    ...Object.entries(answers).map(([q, a]) => `| ${q} | ${a} | User answer |`),
    ...inferred.map(f => `| ${f.dimension} | ${f.fact} | Inferred: ${f.source} |`),
  ];

  const relevantConstraints = constraints
    .filter(c => c.severity === 'critical' || c.severity === 'important')
    .map(c => `- [${c.severity}] ${c.rule}`)
    .join('\n');

  const scopeAnswer = answers['scope-1'] ?? task;

  return `# ${task}

## Problem
${task}

## Scope
- ${scopeAnswer}

## Out of Scope
- To be determined based on implementation

## User Stories
- As a user, I want to ${task.toLowerCase()}, so that the feature is available

## Decisions
| Question | Decision | Reason |
|----------|----------|--------|
${decisionsRows.join('\n')}

## Constraints
${relevantConstraints || '- No specific constraints'}

## Acceptance Criteria
- [ ] Feature implemented as described in scope
- [ ] All new files have corresponding tests
- [ ] TypeScript compiles with no errors
`;
}
