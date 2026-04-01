import type { Tree, Language, Node } from 'web-tree-sitter';

export const LANG_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
};

export interface ParsedFile {
  tree: Tree;
  language: Language;
  langId: string;
  filePath: string;
}

export interface QueryMatch {
  pattern: number;
  captures: { name: string; node: Node }[];
}

export interface AstCheckResult {
  passed: boolean;
  violations: { line: number; column: number; message: string; nodeText: string }[];
}

export interface QueryDef {
  id: string;
  description: string;
  languages: string[];
  queries: Record<string, string>;
}

export interface FileFacts {
  imports: { source: string; style: 'relative' | 'alias' | 'package'; isTypeOnly: boolean }[];
  exports: { name: string; kind: string; hasReturnType: boolean }[];
  tryCatchCount: number;
  classCount: number;
  functionNames: { name: string; style: string }[];
  apiUsages: { name: string; line: number }[];
}

export interface FileAstEntry {
  filePath: string;
  langId: string;
  contentHash: string;
  mtime: number;
  facts: FileFacts;
}

export interface AggregatedFacts {
  totalFiles: number;
  languageBreakdown: Record<string, number>;
  importStyle: { relative: number; alias: number; package: number };
  tryCatchDensity: number;
  namingStyle: Record<string, number>;
  typeCoverage: { typed: number; untyped: number };
  classCount: number;
}

export interface ProjectIndex {
  version: number;
  projectRoot: string;
  generatedAt: string;
  files: FileAstEntry[];
  aggregated: AggregatedFacts;
}

export interface InitProgress {
  phase: 'scan' | 'detect' | 'ast-parse' | 'constraints' | 'context' | 'hooks' | 'done';
  message: string;
  current?: number;
  total?: number;
}

export type ProgressCallback = (progress: InitProgress) => void;
