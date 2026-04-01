import { Query } from 'web-tree-sitter';
import type { ParsedFile, QueryMatch } from './types.js';

export function runQuery(parsed: ParsedFile, querySource: string): QueryMatch[] {
  if (!querySource || !querySource.trim()) return [];

  try {
    const query = new Query(parsed.language, querySource);
    const matches = query.matches(parsed.tree.rootNode);
    const result = matches.map(m => ({
      pattern: m.patternIndex,
      captures: m.captures.map(c => ({ name: c.name, node: c.node })),
    }));
    query.delete();
    return result;
  } catch {
    return [];
  }
}
