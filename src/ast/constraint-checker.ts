import type { AstCheckResult } from './types.js';
import { parseFile } from './parser.js';
import { runQuery } from './query-runner.js';
import { getQuery } from './queries/index.js';

export async function runAstCheck(
  astPattern: string,
  filePath: string,
  content: string,
  constraintRule: string,
): Promise<AstCheckResult | null> {
  const parsed = await parseFile(filePath, content);
  if (!parsed) return null;

  // Resolve pattern: try as predefined query ID first, then as inline S-expression
  let querySource = getQuery(astPattern, parsed.langId);
  if (!querySource) {
    // Treat as inline S-expression
    querySource = astPattern;
  }

  try {
    const matches = runQuery(parsed, querySource);
    if (matches.length === 0) {
      return { passed: true, violations: [] };
    }

    return {
      passed: false,
      violations: matches.map(m => {
        const node = m.captures.find(c => c.name === 'match')?.node
          ?? m.captures[0]?.node;
        return {
          line: (node?.startPosition.row ?? 0) + 1,
          column: (node?.startPosition.column ?? 0) + 1,
          message: constraintRule,
          nodeText: node?.text?.slice(0, 80) ?? '',
        };
      }),
    };
  } catch {
    return null;
  }
}
