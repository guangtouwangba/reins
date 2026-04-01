import type { QueryDef } from '../types.js';

export const TS_QUERIES: QueryDef[] = [
  {
    id: 'try-catch',
    description: 'Find try/catch statements',
    languages: ['typescript', 'tsx', 'javascript'],
    queries: {
      typescript: '(try_statement) @match',
      tsx: '(try_statement) @match',
      javascript: '(try_statement) @match',
    },
  },
  {
    id: 'untyped-export-functions',
    description: 'Find exported functions without return type annotation',
    languages: ['typescript', 'tsx'],
    queries: {
      typescript: '(export_statement (function_declaration !return_type) @match)',
      tsx: '(export_statement (function_declaration !return_type) @match)',
    },
  },
  {
    id: 'relative-imports',
    description: 'Find import statements with relative paths',
    languages: ['typescript', 'tsx', 'javascript'],
    queries: {
      typescript: '(import_statement source: (string (string_fragment) @src (#match? @src "^\\\\.\\\\.?/"))) @match',
      tsx: '(import_statement source: (string (string_fragment) @src (#match? @src "^\\\\.\\\\.?/"))) @match',
      javascript: '(import_statement source: (string (string_fragment) @src (#match? @src "^\\\\.\\\\.?/"))) @match',
    },
  },
  {
    id: 'class-declarations',
    description: 'Find class declarations',
    languages: ['typescript', 'tsx', 'javascript'],
    queries: {
      typescript: '(class_declaration) @match',
      tsx: '(class_declaration) @match',
      javascript: '(class_declaration) @match',
    },
  },
  {
    id: 'new-expressions',
    description: 'Find new expressions (constructor calls)',
    languages: ['typescript', 'tsx', 'javascript'],
    queries: {
      typescript: '(new_expression) @match',
      tsx: '(new_expression) @match',
      javascript: '(new_expression) @match',
    },
  },
];
