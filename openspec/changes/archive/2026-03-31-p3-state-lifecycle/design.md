## Approach

Implement three focused sub-modules under `src/state/`: `manifest.ts` computes and persists a directory snapshot with a stable hash; `diff.ts` compares two manifests to produce a structured diff; `snapshot.ts` serializes full constraint file contents to timestamped directories and restores them atomically. No external dependencies beyond `fs` and `crypto`.

## Architecture

**Manifest** (`src/state/manifest.ts`)

```typescript
interface Manifest {
  version: number;          // schema version, currently 1
  generatedAt: string;      // ISO timestamp
  projectRoot: string;
  directories: DirectoryEntry[];  // { path, fileCount }
  files: FileEntry[];             // { path, size, mtime }
  hash: string;             // SHA-256 of sorted file paths + mtimes
}

saveManifest(projectRoot: string, manifest: Manifest): void
loadManifest(projectRoot: string): Manifest | null
buildManifest(projectRoot: string): Manifest   // scans .reins/ tree
```

- Stored at `.reins/manifest.json` (gitignored)
- Hash is SHA-256 of a canonical string: sorted `file.path + file.mtime` entries joined by `\n`
- Hash equality short-circuits `reins update` before any rescan

**Diff** (`src/state/diff.ts`)

```typescript
interface ManifestDiff {
  added: FileEntry[];
  removed: FileEntry[];
  modified: FileEntry[];   // mtime changed
  unchanged: FileEntry[];
  hasChanges: boolean;
}

diffManifest(prev: Manifest, curr: Manifest): ManifestDiff
```

- Keyed on `file.path`; comparison is mtime-based (no content hash per file, that cost lives in manifest-level hash)
- `hasChanges` is true when any of added/removed/modified is non-empty

**Snapshot** (`src/state/snapshot.ts`)

```typescript
interface Snapshot {
  id: string;            // "20260331T120000Z"
  createdAt: string;     // ISO timestamp
  trigger: string;       // "init" | "update" | "hook-add" | ...
  files: { path: string; content: string }[];
}

saveSnapshot(projectRoot: string, trigger: string): string   // returns id
listSnapshots(projectRoot: string): Snapshot[]               // newest first
restoreSnapshot(projectRoot: string, snapshotId: string): void
```

- Each snapshot is stored as `.reins/snapshots/<id>/snapshot.json`
- `saveSnapshot` captures: `constraints.yaml`, all files in `hooks/`, `profiles/` — the set of files that `restoreSnapshot` needs to fully reconstruct state
- `restoreSnapshot` writes files atomically: write to temp paths, rename into place, then delete files that existed before but are absent in the snapshot

**Data flow for `reins update`**:
```
buildManifest(curr) → diffManifest(prev, curr) → [rescan only changed paths] → mergeConstraints → saveSnapshot("update") → saveManifest(curr)
```

**Data flow for `reins rollback`**:
```
listSnapshots() → [user selects id] → saveSnapshot("pre-rollback") → restoreSnapshot(id)
```

## Key Decisions

- **mtime not content hash per file**: Content hashing every file in the project on every `reins update` is expensive. mtime is fast and sufficient — false positives (same content, newer mtime) just trigger a redundant rescan, not a correctness problem.
- **Snapshot captures constraint files only, not full project**: A snapshot of the whole project would be huge. Only `.reins/` state files are restored. Project source files are managed by git.
- **Snapshot id is timestamp-based**: Simple, sortable, human-readable. No UUID needed because snapshot creation is not a hot path and sub-second collisions are not a real concern.
- **No automatic snapshot pruning in Phase 3**: Pruning (keep last N) is deferred to Phase 4 to keep this change minimal.

## File Structure

```
src/state/manifest.ts          # Manifest interface, build/save/load
src/state/diff.ts              # ManifestDiff interface, diffManifest()
src/state/snapshot.ts          # Snapshot interface, save/list/restore
```
