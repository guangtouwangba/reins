import type { CodebaseContext } from '../scanner/types.js';
import type { Constraint } from '../constraints/schema.js';
import { getLLMProvider } from '../llm/index.js';
import { parseLLMJson } from '../llm/provider.js';

export interface Question {
  id: string;
  dimension: string;
  text: string;
  priority: 'blocking' | 'important' | 'optional';
  default?: string;
  inferredAnswer?: string;
  inferredFrom?: string;
}

export interface InferredFact {
  dimension: string;
  fact: string;
  source: string;
}

export interface CategorizedQuestions {
  inferred: InferredFact[];
  blocking: Question[];
  important: Question[];
  optional: Question[];
}

// Layer 1: Universal dimensions
function universalDimensions(): Question[] {
  return [
    { id: 'scope-1', dimension: 'scope', text: 'What is the core functionality? What is explicitly NOT included?', priority: 'blocking' },
    { id: 'users-1', dimension: 'users', text: 'Who uses this feature? Are there different permission levels?', priority: 'important' },
    { id: 'data-1', dimension: 'data', text: 'What data is created/modified? Any new database tables or fields?', priority: 'important' },
    { id: 'error-1', dimension: 'error', text: 'How should failures be handled? What does the user see on error?', priority: 'optional', default: 'Standard error response with message' },
    { id: 'migration-1', dimension: 'migration', text: 'Does this affect existing users or data? Any migration needed?', priority: 'important' },
    { id: 'auth-1', dimension: 'auth', text: 'Does this need authentication or authorization?', priority: 'important' },
  ];
}

// Layer 2: Context filtering — remove questions that can be inferred
function filterByContext(
  questions: Question[],
  context: CodebaseContext,
  constraints: Constraint[],
): { questions: Question[]; inferred: InferredFact[] } {
  const inferred: InferredFact[] = [];
  let filtered = [...questions];

  // Check for auth middleware
  const hasAuth = context.structure.files.some(
    f => f.path.includes('middleware/auth') || f.path.includes('auth.ts') || f.path.includes('auth.js'),
  );
  if (hasAuth) {
    inferred.push({ dimension: 'auth', fact: 'Reuse existing auth middleware', source: 'detected auth middleware in project' });
    filtered = filtered.filter(q => q.dimension !== 'auth');
  }

  // Check for cloud storage deps
  const deps = getDeps(context);
  if (deps.has('aws-sdk') || deps.has('@aws-sdk/client-s3')) {
    inferred.push({ dimension: 'storage', fact: 'S3', source: 'aws-sdk in dependencies' });
  }
  if (deps.has('@google-cloud/storage')) {
    inferred.push({ dimension: 'storage', fact: 'GCS', source: '@google-cloud/storage in dependencies' });
  }

  // Check constraints for testing requirement
  const testConstraint = constraints.find(c => c.rule.toLowerCase().includes('test'));
  if (testConstraint) {
    inferred.push({ dimension: 'testing', fact: 'Required by project constraints', source: `constraint: ${testConstraint.id}` });
  }

  // Check constraints for ORM
  const ormConstraint = constraints.find(c => c.rule.includes('Prisma') || c.rule.includes('ORM') || c.rule.toLowerCase().includes('prisma'));
  if (ormConstraint) {
    inferred.push({ dimension: 'orm', fact: 'Prisma (project constraint)', source: `constraint: ${ormConstraint.id}` });
  }

  // Check for Prisma in deps
  if (deps.has('prisma') || deps.has('@prisma/client')) {
    if (!inferred.some(f => f.dimension === 'orm')) {
      inferred.push({ dimension: 'orm', fact: 'Prisma', source: '@prisma/client in dependencies' });
    }
  }

  return { questions: filtered, inferred };
}

function getDeps(context: CodebaseContext): Set<string> {
  // Extract dependency names from stack info — we use framework and build tool as proxies
  // In a real implementation, this would read package.json dependencies
  const deps = new Set<string>();
  for (const fw of context.stack.framework) {
    deps.add(fw.toLowerCase());
  }
  return deps;
}

// Layer 3: Task-specific LLM questions
async function generateTaskSpecificQuestions(
  task: string,
  context: CodebaseContext,
  alreadyInferred: InferredFact[],
): Promise<Question[]> {
  const inferredSummary = alreadyInferred.map(f => `- ${f.dimension}: ${f.fact}`).join('\n');
  const stackSummary = [...context.stack.framework, ...context.stack.language].filter(Boolean).join(', ');

  const prompt = `You are a requirements analyst. Given this development task, generate 2-5 additional questions that would help clarify implementation details.

Task: ${task}
Tech Stack: ${stackSummary || 'unknown'}

Already inferred facts:
${inferredSummary || '(none)'}

Return a JSON array of question objects with this shape:
[{"id": "task-1", "dimension": "performance", "text": "...", "priority": "important", "default": "..."}]

Priority must be one of: "blocking", "important", "optional".
Only ask questions NOT covered by the inferred facts above.
Respond with ONLY the JSON array, no markdown fences.`;

  try {
    const raw = await getLLMProvider().complete(prompt, { model: 'haiku' });
    const parsed = parseLLMJson<Array<Partial<Question>>>(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(q => q.id && q.text && q.dimension)
      .map((q, i) => ({
        id: q.id ?? `task-${i + 1}`,
        dimension: q.dimension!,
        text: q.text!,
        priority: (['blocking', 'important', 'optional'].includes(q.priority ?? '') ? q.priority! : 'optional') as Question['priority'],
        ...(q.default ? { default: q.default } : {}),
      }));
  } catch {
    return [];
  }
}

// Main entry point
export async function generateQuestions(
  task: string,
  context: CodebaseContext,
  constraints: Constraint[],
): Promise<CategorizedQuestions> {
  // Layer 1: universal dimensions
  const universalQs = universalDimensions();

  // Layer 2: context filtering
  const { questions: filteredQs, inferred } = filterByContext(universalQs, context, constraints);

  // Layer 3: task-specific (LLM)
  const taskQs = await generateTaskSpecificQuestions(task, context, inferred);

  // Merge and categorize
  const allQuestions = [...filteredQs, ...taskQs];

  return {
    inferred,
    blocking: allQuestions.filter(q => q.priority === 'blocking'),
    important: allQuestions.filter(q => q.priority === 'important'),
    optional: allQuestions.filter(q => q.priority === 'optional'),
  };
}

// Export for testing
export { universalDimensions, filterByContext };
