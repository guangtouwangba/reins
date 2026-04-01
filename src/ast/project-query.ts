import type { ProjectIndex, AggregatedFacts, FileFacts } from './types.js';
import { aggregateFacts } from './project-index.js';

export function queryImportStyle(index: ProjectIndex): { dominant: string; breakdown: Record<string, number> } {
  const { relative, alias, package: pkg } = index.aggregated.importStyle;
  const total = relative + alias + pkg;
  if (total === 0) return { dominant: 'none', breakdown: { relative, alias, package: pkg } };

  const max = Math.max(relative, alias, pkg);
  let dominant = 'package';
  if (max === alias) dominant = 'alias';
  else if (max === relative) dominant = 'relative';

  return { dominant, breakdown: { relative, alias, package: pkg } };
}

export function queryFilesWithPattern(index: ProjectIndex, predicate: (f: FileFacts) => boolean): string[] {
  return index.files.filter(e => predicate(e.facts)).map(e => e.filePath);
}

export function queryDirectoryFacts(index: ProjectIndex, dirPrefix: string): AggregatedFacts {
  const filtered = index.files.filter(e => e.filePath.startsWith(dirPrefix));
  return aggregateFacts(filtered);
}
