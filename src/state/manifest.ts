import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface DirectoryEntry {
  path: string;
  fileCount: number;
}

export interface FileEntry {
  path: string;
  size: number;
  mtime: number;
}

export interface Manifest {
  version: number;
  generatedAt: string;
  projectRoot: string;
  directories: DirectoryEntry[];
  files: FileEntry[];
  hash: string;
}

export interface ManifestDiff {
  added: FileEntry[];
  removed: FileEntry[];
  modified: FileEntry[];
  unchanged: FileEntry[];
  hasChanges: boolean;
}

function collectFiles(dir: string, projectRoot: string, excludeDirs?: string[]): { files: FileEntry[]; dirs: DirectoryEntry[] } {
  const files: FileEntry[] = [];
  const dirs: DirectoryEntry[] = [];
  const excluded = new Set(excludeDirs ?? []);

  if (!existsSync(dir)) return { files, dirs };

  function walk(current: string): void {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }

    let fileCount = 0;
    for (const entry of entries) {
      const fullPath = join(current, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        if (excluded.has(entry)) continue;
        walk(fullPath);
        dirs.push({ path: relative(projectRoot, fullPath), fileCount: 0 });
      } else {
        const relPath = relative(projectRoot, fullPath);
        files.push({ path: relPath, size: stat.size, mtime: stat.mtimeMs });
        fileCount++;
      }
    }

    // Update the dir entry we just pushed
    const relDir = relative(projectRoot, current);
    const existing = dirs.find(d => d.path === relDir);
    if (existing) {
      existing.fileCount = fileCount;
    }
  }

  walk(dir);
  return { files, dirs };
}

function computeHash(files: FileEntry[]): string {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const canonical = sorted.map(f => `${f.path}:${f.mtime}`).join('\n');
  return createHash('sha256').update(canonical).digest('hex');
}

export interface BuildManifestOptions {
  /** Directories to scan for project input files (default: project root) */
  scanRoot?: string;
  /** Directories to exclude */
  excludeDirs?: string[];
}

const DEFAULT_EXCLUDE_DIRS = ['node_modules', '.git', 'dist', 'build', '.reins', 'vendor', 'generated'];

export function buildManifest(projectRoot: string, options?: BuildManifestOptions): Manifest {
  const scanRoot = options?.scanRoot ?? projectRoot;
  const excludeDirs = [...DEFAULT_EXCLUDE_DIRS, ...(options?.excludeDirs ?? [])];

  const { files, dirs } = collectFiles(scanRoot, projectRoot, excludeDirs);
  const hash = computeHash(files);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    projectRoot,
    directories: dirs,
    files,
    hash,
  };
}

/** Build a manifest scoped to the .reins/ directory (legacy behavior). */
export function buildReinsManifest(projectRoot: string): Manifest {
  const reinsDir = join(projectRoot, '.reins');
  const { files, dirs } = collectFiles(reinsDir, projectRoot);
  const hash = computeHash(files);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    projectRoot,
    directories: dirs,
    files,
    hash,
  };
}

export function saveManifest(projectRoot: string, manifest: Manifest): void {
  const reinsDir = join(projectRoot, '.reins');
  mkdirSync(reinsDir, { recursive: true });
  writeFileSync(join(reinsDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
}

export function loadManifest(projectRoot: string): Manifest | null {
  const manifestPath = join(projectRoot, '.reins', 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  try {
    const raw = readFileSync(manifestPath, 'utf-8');
    return JSON.parse(raw) as Manifest;
  } catch {
    return null;
  }
}

export function diffManifest(prev: Manifest, curr: Manifest): ManifestDiff {
  const prevMap = new Map<string, FileEntry>(prev.files.map(f => [f.path, f]));
  const currMap = new Map<string, FileEntry>(curr.files.map(f => [f.path, f]));

  const added: FileEntry[] = [];
  const removed: FileEntry[] = [];
  const modified: FileEntry[] = [];
  const unchanged: FileEntry[] = [];

  for (const [path, currFile] of currMap) {
    const prevFile = prevMap.get(path);
    if (!prevFile) {
      added.push(currFile);
    } else if (prevFile.mtime !== currFile.mtime) {
      modified.push(currFile);
    } else {
      unchanged.push(currFile);
    }
  }

  for (const [path, prevFile] of prevMap) {
    if (!currMap.has(path)) {
      removed.push(prevFile);
    }
  }

  return {
    added,
    removed,
    modified,
    unchanged,
    hasChanges: added.length > 0 || removed.length > 0 || modified.length > 0,
  };
}
