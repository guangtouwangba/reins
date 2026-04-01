import type { QueryDef } from '../types.js';

export const PY_QUERIES: QueryDef[] = [
  {
    id: 'try-except',
    description: 'Find try/except statements',
    languages: ['python'],
    queries: {
      python: '(try_statement) @match',
    },
  },
  {
    id: 'bare-except',
    description: 'Find bare except clauses (no exception type)',
    languages: ['python'],
    queries: {
      python: '(except_clause) @match',
    },
  },
  {
    id: 'class-definitions',
    description: 'Find class definitions',
    languages: ['python'],
    queries: {
      python: '(class_definition) @match',
    },
  },
];
