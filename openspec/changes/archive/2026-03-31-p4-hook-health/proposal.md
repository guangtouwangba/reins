## Why

Hook scripts that crash or emit invalid output silently degrade enforcement—the agent continues operating without the constraints it believes are in effect. Phase 4 adds health tracking to the hook system so that persistently failing hooks are auto-disabled before they create a false sense of security, and provides tooling to diagnose and recover them.

## What Changes

- Enhance `src/hooks/health-monitor.ts` (created in Phase 3) with `recordHookResult(hookId, result, error?)` that tracks consecutive errors and auto-disables a hook after `health_threshold` (default 5) consecutive errors
- Add `HookHealth` interface with `hookId`, `consecutiveErrors`, `lastError`, `lastSuccess`, `disabled`, and `disabledReason` fields
- Persist health state to `.reins/logs/hook-health.yaml`, updated after every hook execution
- Add `reins hook fix` command that reads `hook-health.yaml`, identifies disabled hooks, diagnoses likely causes, and suggests concrete fixes
- Add `reins test integration` command that runs hook health checks and executes synthetic violation tests to verify each hook's detection logic is working
- Wire health recording into the hook execution path so every hook invocation writes a result (success or error with message) to `hook-health.yaml`

## Capabilities

### New Capabilities

- `hook-health-record`: After each hook execution, updates `hook-health.yaml` with success (resets `consecutiveErrors` to 0, updates `lastSuccess`) or error (increments `consecutiveErrors`, stores error message, sets `disabled: true` + `disabledReason` if threshold reached)
- `hook-auto-disable`: When `consecutiveErrors >= health_threshold` (default 5), marks the hook `disabled: true` in both `hook-health.yaml` and `settings.json` so it is no longer invoked by Claude Code; logs a warning to `.reins/logs/`
- `reins hook fix`: Reads disabled hooks from `hook-health.yaml`, inspects each hook script for common failure patterns (missing `jq`, bad shebang, missing file reference, permission error), and prints a numbered list of diagnostic findings with suggested fix commands
- `reins test integration`: Runs two passes—(1) health check: verifies each hook script is executable, its dependencies (`jq`, etc.) are present, and it exits 0 on a clean input; (2) violation test: constructs synthetic inputs that should trigger each hook and asserts `exit 2` is returned

### Modified Capabilities

- `hook-execution` (`src/hooks/health-monitor.ts`): All hook invocations now route through `recordHookResult`; disabled hooks are skipped with a logged warning rather than executed; `lastSuccess` timestamp is reset on any successful execution, clearing the consecutive-error counter

## Impact

- Modified source file: `src/hooks/health-monitor.ts` (add `HookHealth` interface, `recordHookResult`, `loadHookHealth`, `saveHookHealth`, disabled-hook guard)
- New CLI commands: `reins hook fix`, `reins test integration` (wired in `src/cli.ts`)
- New runtime file: `.reins/logs/hook-health.yaml` (gitignored, personal operational state)
- `settings.json` is mutated when a hook is auto-disabled; the generator (`src/hooks/settings-writer.ts`) must be able to read the disabled list from `hook-health.yaml` and exclude those hooks on next regeneration
- Depends on `p2-hook-system` (hook generator, settings-writer, and hook script infrastructure must exist)
- No new npm dependencies; YAML read/write uses the existing yaml library already required by Phase 2
