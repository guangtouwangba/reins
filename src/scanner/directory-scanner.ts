import { readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import type { DirectoryEntry, FileEntry, Manifest } from './types.js';

const ALWAYS_EXCLUDE = new Set(['node_modules', '.git', 'dist', 'build', 'vendor', 'generated']);

export interface ScanResult {
  files: FileEntry[];
  directories: DirectoryEntry[];
  manifest: Manifest;
}

export async function scanDirectory(
  projectRoot: string,
  excludeDirs: string[] = [],
): Promise<ScanResult> {
  const excludeSet = new Set([...ALWAYS_EXCLUDE, ...excludeDirs.map(d => d.replace(/\/$/, ''))]);
  const files: FileEntry[] = [];
  const directories: DirectoryEntry[] = [];

  function walk(dir: string, depth: number): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (excludeSet.has(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      const relPath = relative(projectRoot, fullPath);

      if (entry.isDirectory()) {
        directories.push({ path: relPath, depth });
        walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        try {
          const stat = statSync(fullPath);
          files.push({ path: relPath, size: stat.size, mtime: stat.mtimeMs });
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  walk(projectRoot, 0);

  files.sort((a, b) => a.path.localeCompare(b.path));
  directories.sort((a, b) => a.path.localeCompare(b.path));

  const hashInput = files.map(f => `${f.path}:${f.mtime}`).join('\n');
  const hash = createHash('sha256').update(hashInput).digest('hex');

  const manifest: Manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    projectRoot,
    directories,
    files,
    hash,
  };

  return { files, directories, manifest };
}
