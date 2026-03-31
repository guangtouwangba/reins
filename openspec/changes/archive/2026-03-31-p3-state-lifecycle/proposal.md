## Why

The MVP captures no history of constraint changes, making it impossible to understand what changed between runs or to recover from a bad `reins init --force`. Manifest diffing and snapshots enable incremental updates and safe rollback for all state-mutating commands.

## What Changes

- Add `Manifest` interface with version, generatedAt, directories, files, and a content hash for change detection
- Add `ManifestDiff` type and `diffManifest(prev, curr)` function for incremental constraint updates
- Add `Snapshot` interface capturing the full content of all `.reins/` constraint files at a point in time
- Add `saveSnapshot`, `listSnapshots`, and `restoreSnapshot` operations backed by `.reins/snapshots/`
- Wire snapshot creation into all state-mutating commands (`init`, `update`, `hook add`)

## Capabilities

### New Capabilities

- `manifest-diff`: Compute file-level diff between two manifests, identifying added, removed, and modified paths for use by `reins update`'s incremental scan
- `snapshot-save`: Capture a timestamped snapshot of all constraint files before any mutation, keyed by trigger name
- `snapshot-list`: Return all available snapshots with metadata (id, timestamp, trigger) for display by `reins rollback`
- `snapshot-restore`: Atomically restore constraint files from a selected snapshot, replacing current state

### Modified Capabilities

- `manifest-save` / `manifest-load`: Extended from a simple file write to include hash computation and versioning

## Impact

- New source files: `src/state/manifest.ts`, `src/state/diff.ts`, `src/state/snapshot.ts`
- All state-mutating commands in `src/cli.ts` must call `saveSnapshot()` before writing
- `reins update` (p3-cli-commands) depends on `diffManifest()` to determine what to rescan
- `reins rollback` (p3-cli-commands) depends on `listSnapshots()` and `restoreSnapshot()`
- `.reins/snapshots/` directory is personal (gitignored), `.reins/manifest.json` is personal (gitignored)
