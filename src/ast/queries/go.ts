import type { QueryDef } from '../types.js';

export const GO_QUERIES: QueryDef[] = [
  {
    id: 'panic-calls',
    description: 'Find panic() calls',
    languages: ['go'],
    queries: {
      go: '(call_expression function: (identifier) @fn (#eq? @fn "panic")) @match',
    },
  },
  {
    id: 'type-declarations',
    description: 'Find type declarations',
    languages: ['go'],
    queries: {
      go: '(type_declaration) @match',
    },
  },
];
