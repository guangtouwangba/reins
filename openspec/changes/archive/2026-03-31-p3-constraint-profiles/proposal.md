## Why

The MVP generates a single flat set of constraints applied uniformly to all tasks, but real projects need different strictness levels for different contexts (quick prototyping vs. security-sensitive changes vs. CI). Additionally, re-running `reins init` on an existing project currently has no safe merge behavior — it would overwrite user modifications.

## What Changes

- Add a `profiles` section to `constraints.yaml` with four built-in profiles: `strict`, `default`, `relaxed`, `ci`
- Each profile specifies which constraint severities are active, which hooks fire, and which pipeline stages run
- Add `src/constraints/profiles.ts` to read, resolve, and apply the active profile at runtime
- Add `src/constraints/merger.ts` with the full merge strategy for re-init: keep manual edits, add new detections as draft, mark removed constraints as deprecated, surface conflicts interactively
- Add `src/constraints/conflict-detector.ts` to identify when a re-scanned constraint rule differs from the existing one for the same id
- Wire merge strategy into `reins init --merge` (default), `--force`, and `--diff` flags

## Capabilities

### New Capabilities

- `profile-resolve`: Given a profile name, return the effective set of active constraints, hooks, and pipeline stages for use by `reins develop` and `reins test`
- `profile-list`: Enumerate all profiles defined in `constraints.yaml` (built-in + any user-defined)
- `reinit-merge`: Run a full merge of newly scanned constraints against the existing `constraints.yaml`, producing a `MergeResult` with kept/added/deprecated/conflicts
- `conflict-detect`: Identify pairs of (existing constraint, new scan result) where the id matches but the rule text differs, requiring user resolution

### Modified Capabilities

- `reins init`: Now supports `--merge` (default), `--force`, `--diff` flags; calls `mergeConstraints` instead of overwriting when `.reins/` already exists
- `reins develop`: Reads the `--profile` option and filters constraints/hooks/pipeline through `resolveProfile` before execution

## Impact

- New source files: `src/constraints/profiles.ts`, `src/constraints/merger.ts`, `src/constraints/conflict-detector.ts`
- `src/constraints/schema.ts`: Add `Profile` type and `profiles` field to `ConstraintsFile` interface
- `src/cli.ts`: Add `--merge`, `--force`, `--diff` flags to `init`; pass `--profile` through `develop` to `resolveProfile`
- `constraints.yaml` schema gains a `profiles` top-level section (backward-compatible; defaults apply if absent)
- `reins develop` (p2-reins-develop) gains a runtime dependency on `resolveProfile`
