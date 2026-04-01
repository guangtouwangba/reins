import type { ParsedFile, FileFacts } from './types.js';
import { runQuery } from './query-runner.js';
import { classifyNamingStyle } from './utils.js';

// Per-language fact extraction queries
const FACT_QUERIES: Record<string, Record<string, string>> = {
  typescript: {
    imports: '(import_statement source: (string (string_fragment) @src)) @imp',
    tryCatch: '(try_statement) @match',
    classes: '(class_declaration) @match',
    functions: '(function_declaration name: (identifier) @name) @fn',
    exports: '(export_statement) @exp',
  },
  tsx: {
    imports: '(import_statement source: (string (string_fragment) @src)) @imp',
    tryCatch: '(try_statement) @match',
    classes: '(class_declaration) @match',
    functions: '(function_declaration name: (identifier) @name) @fn',
    exports: '(export_statement) @exp',
  },
  javascript: {
    imports: '(import_statement source: (string (string_fragment) @src)) @imp',
    tryCatch: '(try_statement) @match',
    classes: '(class_declaration) @match',
    functions: '(function_declaration name: (identifier) @name) @fn',
  },
  python: {
    tryCatch: '(try_statement) @match',
    classes: '(class_definition) @match',
    functions: '(function_definition name: (identifier) @name) @fn',
  },
};

export function extractFacts(parsed: ParsedFile): FileFacts {
  const facts: FileFacts = {
    imports: [],
    exports: [],
    tryCatchCount: 0,
    classCount: 0,
    functionNames: [],
    apiUsages: [],
  };

  const queries = FACT_QUERIES[parsed.langId];
  if (!queries) return facts;

  // Imports (TS/JS only)
  if (queries.imports) {
    const matches = runQuery(parsed, queries.imports);
    for (const m of matches) {
      const src = m.captures.find(c => c.name === 'src')?.node.text ?? '';
      let style: 'relative' | 'alias' | 'package' = 'package';
      if (src.startsWith('.') || src.startsWith('..')) style = 'relative';
      else if (src.startsWith('@/') || src.startsWith('~/')) style = 'alias';
      facts.imports.push({ source: src, style, isTypeOnly: false });
    }
  }

  // Try/catch count
  if (queries.tryCatch) {
    const matches = runQuery(parsed, queries.tryCatch);
    facts.tryCatchCount = matches.length;
  }

  // Classes
  if (queries.classes) {
    const matches = runQuery(parsed, queries.classes);
    facts.classCount = matches.length;
  }

  // Function names
  if (queries.functions) {
    const matches = runQuery(parsed, queries.functions);
    for (const m of matches) {
      const name = m.captures.find(c => c.name === 'name')?.node.text ?? '';
      if (name) {
        facts.functionNames.push({ name, style: classifyNamingStyle(name) });
      }
    }
  }

  // Exports (TS/TSX only) — simplified: mark all exports without return type info
  if (queries.exports) {
    const matches = runQuery(parsed, queries.exports);
    for (const m of matches) {
      // Try to find a named function export via a nested function_declaration name
      const expNode = m.captures.find(c => c.name === 'exp')?.node;
      if (!expNode) continue;

      // Walk captures looking for function declaration name inside export
      const nameCapture = m.captures.find(c => c.name === 'name');
      if (nameCapture) {
        facts.exports.push({ name: nameCapture.node.text, kind: 'function', hasReturnType: false });
      } else {
        // Try to extract name from text heuristically
        const text = expNode.text ?? '';
        const fnMatch = /export\s+(?:async\s+)?function\s+(\w+)/.exec(text);
        const constMatch = /export\s+(?:const|let|var)\s+(\w+)/.exec(text);
        const classMatch = /export\s+class\s+(\w+)/.exec(text);
        const name = fnMatch?.[1] ?? constMatch?.[1] ?? classMatch?.[1] ?? '';
        if (name) {
          const kind = classMatch ? 'class' : fnMatch ? 'function' : 'variable';
          facts.exports.push({ name, kind, hasReturnType: false });
        }
      }
    }
  }

  return facts;
}
