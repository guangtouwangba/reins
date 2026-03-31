## Why

After MVP, users have no way to inspect constraint health, update constraints incrementally, test hook correctness, recover from bad state, or manage hooks after initial setup. These five commands close the operational gap between `reins init` (a one-time setup) and a continuously maintained constraint system.

## What Changes

- Add `reins status [--filter <severity>] [--format json|human|markdown] [--since <duration>]`: reads logs and `constraints.yaml`, shows per-constraint violation trends, and surfaces improvement suggestions
- Add `reins update [--auto-apply]`: runs an incremental scan using `diffManifest`, computes constraint diffs against existing `constraints.yaml`, and presents suggested changes (auto-applies high-confidence ones if `--auto-apply`)
- Add `reins test`: runs hook health checks (executes each hook with a synthetic passing and failing input) and reports which hooks fire correctly
- Add `reins rollback [--to <snapshot-id>]`: lists available snapshots and restores a selected one, with an automatic pre-rollback snapshot for safety
- Add `reins hook <add|list|disable|fix|promote>`: full lifecycle management for hooks — generate from natural-language description, list with status, disable by id, attempt auto-fix of broken hooks, promote a constraint to an enforcing hook

## Capabilities

### New Capabilities

- `status-report`: Aggregate logs + constraint metadata into a structured status view with violation counts, trend direction, and top suggestions
- `incremental-update`: Diff current file tree against last manifest, rescan only changed paths, merge new constraints into existing `constraints.yaml` as drafts
- `hook-health-check`: Execute each registered hook with synthetic inputs and classify as passing, failing, or broken (exit-code unexpected)
- `snapshot-rollback`: Interactive snapshot selection and atomic restore via `restoreSnapshot` from p3-state-lifecycle
- `hook-add-from-description`: Accept a natural-language hook description, generate the hook script via LLM, write to `.reins/hooks/`, register in `constraints.yaml`
- `hook-fix`: Detect hooks that consistently return unexpected exit codes and attempt LLM-assisted repair
- `hook-promote`: Elevate a constraint's enforcement from soft (CLAUDE.md mention) to hard (blocking hook)

### Modified Capabilities

- `reins init`: Now calls `saveSnapshot` before writing (from p3-state-lifecycle); no user-facing change

## Impact

- New source files: `src/commands/status.ts`, `src/commands/update.ts`, `src/commands/test.ts`, `src/commands/rollback.ts`, `src/commands/hook.ts`
- `src/cli.ts`: Register all five new commands with Commander.js
- Depends on p3-state-lifecycle for `diffManifest`, `saveSnapshot`, `listSnapshots`, `restoreSnapshot`
- Depends on p2-hook-system for hook execution primitives used by `reins test` and `hook fix`
- `status` reads `.reins/logs/` — log format established by p2-pipeline-runner must be stable
