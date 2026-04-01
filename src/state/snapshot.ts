import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';

export interface SnapshotFile {
  path: string;
  content: string;
}

export interface Snapshot {
  id: string;
  createdAt: string;
  trigger: string;
  files: SnapshotFile[];
}

const CAPTURED_FILES = ['constraints.yaml'];
const CAPTURED_DIRS = ['hooks', 'profiles'];

function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace('.', '');
}

function collectSnapshotFiles(projectRoot: string): SnapshotFile[] {
  const reinsDir = join(projectRoot, '.reins');
  const captured: SnapshotFile[] = [];

  for (const file of CAPTURED_FILES) {
    const fullPath = join(reinsDir, file);
    if (existsSync(fullPath)) {
      captured.push({ path: file, content: readFileSync(fullPath, 'utf-8') });
    }
  }

  for (const dir of CAPTURED_DIRS) {
    const fullDir = join(reinsDir, dir);
    if (!existsSync(fullDir)) continue;
    try {
      const entries = readdirSync(fullDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          const relPath = `${dir}/${entry.name}`;
          const content = readFileSync(join(fullDir, entry.name), 'utf-8');
          captured.push({ path: relPath, content });
        }
      }
    } catch {
      // skip unreadable dirs
    }
  }

  return captured;
}

export function saveSnapshot(projectRoot: string, trigger: string): string {
  const base = formatTimestamp(new Date());
  // Ensure uniqueness: if a directory with this id already exists, append a counter
  let id = base;
  let counter = 1;
  while (existsSync(join(projectRoot, '.reins', 'snapshots', id))) {
    id = `${base}-${counter}`;
    counter++;
  }

  const snapshot: Snapshot = {
    id,
    createdAt: new Date().toISOString(),
    trigger,
    files: collectSnapshotFiles(projectRoot),
  };

  const snapshotDir = join(projectRoot, '.reins', 'snapshots', id);
  mkdirSync(snapshotDir, { recursive: true });
  writeFileSync(join(snapshotDir, 'snapshot.json'), JSON.stringify(snapshot, null, 2), 'utf-8');

  return id;
}

export function listSnapshots(projectRoot: string): Snapshot[] {
  const snapshotsDir = join(projectRoot, '.reins', 'snapshots');
  if (!existsSync(snapshotsDir)) return [];

  let entries: string[];
  try {
    entries = readdirSync(snapshotsDir);
  } catch {
    return [];
  }

  const snapshots: Snapshot[] = [];
  for (const entry of entries) {
    const snapshotPath = join(snapshotsDir, entry, 'snapshot.json');
    if (!existsSync(snapshotPath)) continue;
    try {
      const raw = readFileSync(snapshotPath, 'utf-8');
      snapshots.push(JSON.parse(raw) as Snapshot);
    } catch {
      // skip malformed
    }
  }

  // Sort newest first
  return snapshots.sort((a, b) => b.id.localeCompare(a.id));
}

export function restoreSnapshot(projectRoot: string, snapshotId: string): void {
  const snapshotPath = join(projectRoot, '.reins', 'snapshots', snapshotId, 'snapshot.json');
  if (!existsSync(snapshotPath)) {
    throw new Error(`Snapshot not found: ${snapshotId}`);
  }

  const raw = readFileSync(snapshotPath, 'utf-8');
  const snapshot: Snapshot = JSON.parse(raw);

  const reinsDir = join(projectRoot, '.reins');
  const restoredPaths = new Set<string>();

  // Write each file atomically: write to temp, rename into place
  for (const file of snapshot.files) {
    const targetPath = join(reinsDir, file.path);
    const tempPath = targetPath + '.tmp';
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(tempPath, file.content, 'utf-8');
    renameSync(tempPath, targetPath);
    restoredPaths.add(file.path);
  }

  // Remove files that existed before but are absent from snapshot
  for (const dir of CAPTURED_DIRS) {
    const fullDir = join(reinsDir, dir);
    if (!existsSync(fullDir)) continue;
    try {
      const entries = readdirSync(fullDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          const relPath = `${dir}/${entry.name}`;
          if (!restoredPaths.has(relPath)) {
            unlinkSync(join(fullDir, entry.name));
          }
        }
      }
    } catch {
      // skip
    }
  }

  // Remove captured top-level files absent from snapshot
  for (const file of CAPTURED_FILES) {
    const fullPath = join(reinsDir, file);
    if (existsSync(fullPath) && !restoredPaths.has(file)) {
      unlinkSync(fullPath);
    }
  }
}
