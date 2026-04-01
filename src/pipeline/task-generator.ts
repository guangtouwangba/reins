import type { Constraint } from '../constraints/schema.js';

export interface TaskGenInput {
  designContent: string;
  specContent: string;
  constraints: Constraint[];
}

/** Generate tasks.md from a confirmed design.
 *  In production, this uses an LLM (sonnet) to decompose the design.
 *  This implementation generates a basic task structure. */
export async function generateTasks(input: TaskGenInput): Promise<string> {
  const { constraints } = input;
  const constraintIds = constraints.slice(0, 3).map(c => c.id).join(', ');

  return `## Tasks

- [ ] **Task 1: Set up data model**
  - Description: Create or update data models as specified in the design
  - Files: src/models/
  - Constraints: ${constraintIds || 'none'}
  - Verify: pnpm typecheck
  - Done when: Data model compiles and matches design spec

- [ ] **Task 2: Implement core service**
  - Description: Implement the main business logic
  - Files: src/services/
  - Constraints: ${constraintIds || 'none'}
  - Verify: pnpm test
  - Done when: Service functions work as specified

- [ ] **Task 3: Add API endpoints**
  - Description: Create API routes that expose the service
  - Files: src/api/
  - Constraints: ${constraintIds || 'none'}
  - Verify: pnpm typecheck && pnpm test
  - Done when: API endpoints respond correctly

- [ ] **Task 4: Final verification**
  - Description: Run full test suite and lint
  - Verify: pnpm lint && pnpm test
  - Done when: All tests pass, no lint errors
`;
}
