import type { QueryDef } from '../types.js';
import { TS_QUERIES } from './typescript.js';
import { PY_QUERIES } from './python.js';
import { GO_QUERIES } from './go.js';

export const QUERY_REGISTRY: QueryDef[] = [
  ...TS_QUERIES,
  ...PY_QUERIES,
  ...GO_QUERIES,
];

export function getQuery(id: string, langId: string): string | null {
  const def = QUERY_REGISTRY.find(q => q.id === id);
  if (!def) return null;
  return def.queries[langId] ?? null;
}

export function listQueries(): QueryDef[] {
  return QUERY_REGISTRY;
}
