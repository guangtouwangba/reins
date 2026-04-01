import type { CodebaseContext } from '../scanner/types.js';
import type { Constraint } from '../constraints/schema.js';

export interface DesignInput {
  specContent: string;
  context: CodebaseContext;
  constraints: Constraint[];
}

/** Generate a design.md document from a confirmed spec.
 *  In production, this uses an LLM (sonnet) for architectural reasoning.
 *  This implementation generates a structural template. */
export async function generateDesign(input: DesignInput): Promise<string> {
  const { specContent, context } = input;
  const framework = context.stack.framework[0] ?? 'unknown';
  const lang = context.stack.language[0] ?? 'unknown';

  return `# Technical Design

## Architecture
\`\`\`
Client → API → Service → Storage
\`\`\`

## API Design
*To be designed based on spec requirements*

## Data Model Changes
*To be determined based on spec scope*

## File Plan
| Action | File | Purpose |
|--------|------|---------|
| Create | src/service.${lang === 'TypeScript' ? 'ts' : lang === 'Go' ? 'go' : 'ts'} | Core service logic |
| Create | src/service.test.${lang === 'TypeScript' ? 'ts' : 'ts'} | Service tests |

## Key Technical Decisions
- Framework: ${framework}
- Language: ${lang}
- Architecture: ${context.architecture.pattern}
`;
}
