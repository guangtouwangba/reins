## Tasks

- [ ] **Task 1: Implement manifest.ts**
  - Description: Define `Manifest`, `DirectoryEntry`, `FileEntry` interfaces. Implement `buildManifest()` that walks `.reins/` (excluding `snapshots/` and `logs/`) and computes the SHA-256 hash. Implement `saveManifest()` writing to `.reins/manifest.json` and `loadManifest()` reading from it.
  - Files: `src/state/manifest.ts`
  - Tests: Unit test `buildManifest` with a fixture `.reins/` tree; test `saveManifest` + `loadManifest` round-trip; test hash changes when a file is added or its mtime changes.
  - Done when: `buildManifest`, `saveManifest`, `loadManifest` are exported and pass unit tests; hash is deterministic for the same inputs.

- [ ] **Task 2: Implement diff.ts**
  - Description: Define `ManifestDiff` interface. Implement `diffManifest(prev, curr)` that compares `files` arrays by path, classifies each as added/removed/modified/unchanged, and sets `hasChanges`.
  - Files: `src/state/diff.ts`
  - Tests: Unit tests for all four classification cases; test `hasChanges` is false when manifests are identical; test that only mtime difference (not path presence) triggers `modified`.
  - Done when: `diffManifest` is exported, handles empty prev/curr manifests, and passes unit tests.

- [ ] **Task 3: Implement snapshot.ts**
  - Description: Define `Snapshot` interface. Implement `saveSnapshot(projectRoot, trigger)` that reads `constraints.yaml`, `hooks/**`, and `profiles/**` into memory and writes them to `.reins/snapshots/<id>/snapshot.json`. Implement `listSnapshots()` that reads all snapshot dirs and returns them sorted newest-first. Implement `restoreSnapshot(projectRoot, snapshotId)` that atomically writes snapshot files back to their original paths.
  - Files: `src/state/snapshot.ts`
  - Tests: Unit test `saveSnapshot` creates the expected directory structure; test `listSnapshots` returns entries sorted by id descending; test `restoreSnapshot` correctly recreates files and removes files not in the snapshot.
  - Done when: All three functions exported and passing tests; restore is atomic (no partial state on error).

- [ ] **Task 4: Wire snapshot creation into CLI commands**
  - Description: In `src/cli.ts`, add `saveSnapshot(projectRoot, "init")` before writing any constraint files in the `init` command, `saveSnapshot(projectRoot, "update")` in the `update` command, and `saveSnapshot(projectRoot, "hook-add")` in `hook add`. Also call `buildManifest` + `saveManifest` at the end of `init` and `update`.
  - Files: `src/cli.ts`
  - Tests: Integration test that running `reins init` on a project with an existing `.reins/` creates a snapshot in `.reins/snapshots/`; test that running it twice creates two snapshots.
  - Done when: All three commands create snapshots before mutation; `manifest.json` is updated after `init` and `update`.
