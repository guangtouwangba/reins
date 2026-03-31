import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CodebaseContext } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ASTAnalysis {
  importPatterns: {
    relativeRatio: number;
    absoluteRatio: number;
    aliasRatio: number;
    mostUsedSources: string[];
  };
  errorHandlingStyle: {
    tryCatchRatio: number;
    resultTypeRatio: number;
    callbackErrorRatio: number;
  };
  typeAnnotationDensity: number;
  recurringIdioms: string[];
}

// ---------------------------------------------------------------------------
// analyzeAST
// ---------------------------------------------------------------------------

export function analyzeAST(
  projectRoot: string,
  sampleFiles: string[],
): Partial<CodebaseContext> {
  const analysis = performAnalysis(projectRoot, sampleFiles);

  // Map analysis to CodebaseContext.conventions
  const importStyle = deriveImportStyle(analysis.importPatterns);

  return {
    conventions: {
      naming: 'unknown',
      fileStructure: 'unknown',
      importStyle,
      configFormat: 'unknown',
    },
  };
}

// ---------------------------------------------------------------------------
// Internal analysis (regex-based, L3 proxy)
// ---------------------------------------------------------------------------

function performAnalysis(projectRoot: string, sampleFiles: string[]): ASTAnalysis {
  let totalImports = 0;
  let relativeImports = 0;
  let aliasImports = 0;
  let absoluteImports = 0;
  let tryCatchCount = 0;
  let resultTypeCount = 0;
  let totalFunctions = 0;
  let annotatedFunctions = 0;

  const importSourceCounts = new Map<string, number>();

  for (const filePath of sampleFiles) {
    const fullPath = existsSync(filePath) ? filePath : join(projectRoot, filePath);
    if (!existsSync(fullPath)) continue;

    let content: string;
    try {
      content = readFileSync(fullPath, 'utf-8');
    } catch {
      continue;
    }

    // Import pattern extraction via regex
    const importMatches = content.matchAll(/import\s+.*?\s+from\s+['"]([^'"]+)['"]/g);
    for (const match of importMatches) {
      totalImports++;
      const source = match[1] ?? '';

      if (source.startsWith('./') || source.startsWith('../')) {
        relativeImports++;
      } else if (source.startsWith('@/') || source.startsWith('~/') || source.startsWith('#')) {
        aliasImports++;
      } else {
        absoluteImports++;
      }

      // Track most-used import sources
      const baseSource = source.split('/')[0] ?? source;
      importSourceCounts.set(baseSource, (importSourceCounts.get(baseSource) ?? 0) + 1);
    }

    // Error handling style detection
    const tryCatchMatches = content.match(/try\s*\{/g);
    if (tryCatchMatches) tryCatchCount += tryCatchMatches.length;

    const resultTypeMatches = content.match(/Result<|Either<|\.ok\(|\.err\(|isOk\(\)|isErr\(\)/g);
    if (resultTypeMatches) resultTypeCount += resultTypeMatches.length;

    // Type annotation density (annotated return types)
    const funcMatches = content.match(/(?:function\s+\w+|=>\s*\{|\)\s*:\s*\w)/g);
    if (funcMatches) totalFunctions += funcMatches.length;

    const annotatedMatches = content.match(/\)\s*:\s*(?:void|string|number|boolean|Promise|[A-Z]\w+)/g);
    if (annotatedMatches) annotatedFunctions += annotatedMatches.length;
  }

  const mostUsedSources = Array.from(importSourceCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([src]) => src);

  const relativeRatio = totalImports > 0 ? relativeImports / totalImports : 0;
  const aliasRatio = totalImports > 0 ? aliasImports / totalImports : 0;
  const absoluteRatio = totalImports > 0 ? absoluteImports / totalImports : 0;

  const totalHandling = tryCatchCount + resultTypeCount;
  const tryCatchRatio = totalHandling > 0 ? tryCatchCount / totalHandling : 0;
  const resultTypeRatio = totalHandling > 0 ? resultTypeCount / totalHandling : 0;

  const typeAnnotationDensity = totalFunctions > 0 ? annotatedFunctions / totalFunctions : 0;

  return {
    importPatterns: { relativeRatio, absoluteRatio, aliasRatio, mostUsedSources },
    errorHandlingStyle: { tryCatchRatio, resultTypeRatio, callbackErrorRatio: 0 },
    typeAnnotationDensity,
    recurringIdioms: [],
  };
}

function deriveImportStyle(patterns: ASTAnalysis['importPatterns']): string {
  if (patterns.aliasRatio > 0.3) return 'alias';
  if (patterns.relativeRatio > 0.6) return 'relative';
  if (patterns.absoluteRatio > 0.6) return 'absolute';
  return 'mixed';
}
