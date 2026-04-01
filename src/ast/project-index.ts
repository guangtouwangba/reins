import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { FileAstEntry, AggregatedFacts, ProjectIndex, ProgressCallback } from './types.js';
import { parseFile, detectLanguage } from './parser.js';
import { extractFacts } from './fact-extractor.js';

export async function buildProjectIndex(
  projectRoot: string,
  filePaths: string[],
  existingIndex?: ProjectIndex,
  onProgress?: ProgressCallback,
): Promise<ProjectIndex> {
  const sourceFiles = filePaths.filter(f => detectLanguage(f) !== null);
  const entries: FileAstEntry[] = [];

  // Build a Map for O(1) incremental cache lookup instead of O(n) find per file
  const cachedEntries = new Map<string, FileAstEntry>();
  if (existingIndex) {
    for (const entry of existingIndex.files) {
      cachedEntries.set(entry.filePath, entry);
    }
  }

  for (let i = 0; i < sourceFiles.length; i++) {
    const filePath = sourceFiles[i]!;
    onProgress?.({
      phase: 'ast-parse',
      message: 'Analyzing code',
      current: i + 1,
      total: sourceFiles.length,
    });

    const absPath = resolve(projectRoot, filePath);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(absPath);
    } catch {
      continue; // file gone
    }

    // Incremental: reuse cached entry if mtime unchanged
    const cached = cachedEntries.get(filePath);
    if (cached && cached.mtime === stat.mtimeMs) {
      entries.push(cached);
      continue;
    }

    // Read and parse
    let content: string;
    try {
      content = readFileSync(absPath, 'utf-8');
    } catch {
      continue;
    }

    const parsed = await parseFile(filePath, content);
    if (!parsed) continue;

    const facts = extractFacts(parsed);
    entries.push({
      filePath,
      langId: parsed.langId,
      contentHash: createHash('sha256').update(content).digest('hex'),
      mtime: stat.mtimeMs,
      facts,
    });
  }

  onProgress?.({ phase: 'ast-parse', message: 'Aggregating results', current: sourceFiles.length, total: sourceFiles.length });

  const aggregated = aggregateFacts(entries);

  return {
    version: 1,
    projectRoot,
    generatedAt: new Date().toISOString(),
    files: entries,
    aggregated,
  };
}

export function aggregateFacts(entries: FileAstEntry[]): AggregatedFacts {
  const langBreakdown: Record<string, number> = {};
  let relativeImports = 0, aliasImports = 0, packageImports = 0;
  let totalTryCatch = 0, totalClasses = 0;
  let typedExports = 0, untypedExports = 0;
  const namingStyles: Record<string, number> = {};

  for (const entry of entries) {
    langBreakdown[entry.langId] = (langBreakdown[entry.langId] ?? 0) + 1;

    for (const imp of entry.facts.imports) {
      if (imp.style === 'relative') relativeImports++;
      else if (imp.style === 'alias') aliasImports++;
      else packageImports++;
    }

    totalTryCatch += entry.facts.tryCatchCount;
    totalClasses += entry.facts.classCount;

    for (const fn of entry.facts.functionNames) {
      namingStyles[fn.style] = (namingStyles[fn.style] ?? 0) + 1;
    }

    for (const exp of entry.facts.exports) {
      if (exp.hasReturnType) typedExports++;
      else untypedExports++;
    }
  }

  return {
    totalFiles: entries.length,
    languageBreakdown: langBreakdown,
    importStyle: { relative: relativeImports, alias: aliasImports, package: packageImports },
    tryCatchDensity: entries.length > 0 ? totalTryCatch / entries.length : 0,
    namingStyle: namingStyles,
    typeCoverage: { typed: typedExports, untyped: untypedExports },
    classCount: totalClasses,
  };
}

export function saveProjectIndex(projectRoot: string, index: ProjectIndex): void {
  const reinsDir = join(projectRoot, '.reins');
  if (!existsSync(reinsDir)) {
    mkdirSync(reinsDir, { recursive: true });
  }
  const indexPath = join(reinsDir, 'ast-index.json');
  // Strip tree references (not serializable), keep only facts
  const serializable = {
    ...index,
    files: index.files.map(f => ({ ...f })),
  };
  writeFileSync(indexPath, JSON.stringify(serializable, null, 2), 'utf-8');
}

export function loadProjectIndex(projectRoot: string): ProjectIndex | null {
  const indexPath = join(projectRoot, '.reins', 'ast-index.json');
  if (!existsSync(indexPath)) return null;
  try {
    return JSON.parse(readFileSync(indexPath, 'utf-8')) as ProjectIndex;
  } catch {
    return null;
  }
}
