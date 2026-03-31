## Approach

Health monitoring is a thin wrapper around the existing hook invocation path. Every hook execution already produces an exit code and optional stderr; the health monitor reads those signals and maintains a YAML file. Auto-disable writes to two places: `hook-health.yaml` (operational state) and `settings.json` (prevents future invocation). The `reins hook fix` and `reins test integration` commands are diagnostic-only and never mutate hook scripts themselves—they only report and suggest.

## Architecture

**HookHealth Interface and health-monitor.ts** (`src/hooks/health-monitor.ts`)

```typescript
interface HookHealth {
  hookId: string;
  consecutiveErrors: number;
  lastError: string | null;
  lastSuccess: string | null;
  disabled: boolean;
  disabledReason: string | null;
}

function recordHookResult(
  projectRoot: string,
  hookId: string,
  result: 'success' | 'error',
  error?: string
): void

function loadHookHealth(projectRoot: string, hookId: string): HookHealth
function saveHookHealth(projectRoot: string, hookId: string, health: HookHealth): void
function isHookDisabled(projectRoot: string, hookId: string): boolean
function getAllHookHealth(projectRoot: string): HookHealth[]
```

`recordHookResult` logic:
- Load current health for `hookId` (or initialize with defaults if not present).
- `result === 'success'`: set `consecutiveErrors = 0`, set `lastSuccess = now()`.
- `result === 'error'`: increment `consecutiveErrors`, set `lastError = error ?? 'unknown'`.
  - If `consecutiveErrors >= config.hooks.health_threshold` (default 5): set `disabled = true`, set `disabledReason = "Consecutive errors: ${consecutiveErrors}. Last: ${error}"`, call `disableHookInSettings(projectRoot, hookId)`.
- Save health state to `.reins/logs/hook-health.yaml`.

`disableHookInSettings(projectRoot, hookId)`:
- Read `.claude/settings.json`.
- Find all hook entries whose `command` contains `hookId`.
- Remove those entries from the hooks arrays.
- Write back `settings.json`.

**hook-health.yaml schema**:
```yaml
# .reins/logs/hook-health.yaml
version: 1
hooks:
  - hookId: "no-direct-sql"
    consecutiveErrors: 0
    lastError: null
    lastSuccess: "2026-03-31T10:00:00Z"
    disabled: false
    disabledReason: null
  - hookId: "bash-guard"
    consecutiveErrors: 6
    lastError: "jq: command not found"
    lastSuccess: "2026-03-28T09:00:00Z"
    disabled: true
    disabledReason: "Consecutive errors: 6. Last: jq: command not found"
```

**reins hook fix** (diagnostic command, `src/cli.ts`)

```
reins hook fix
  → getAllHookHealth() → filter disabled:true
  → for each disabled hook:
      → read hook script content
      → run diagnostics:
          1. Check shebang line (must be #!/bin/bash or #!/bin/sh)
          2. Check jq availability: `which jq`
          3. Check referenced files exist (grep for file paths in script)
          4. Check script is executable: `test -x <path>`
          5. Run hook with empty input: echo '{}' | <script>; capture exit code and stderr
      → print numbered findings with concrete fix suggestions
```

Output format:
```
Hook "bash-guard" is disabled (6 consecutive errors: jq: command not found)

Diagnostics:
  1. ✗ jq not found in PATH
     Fix: brew install jq   (or: apt-get install jq)
  2. ✓ Script is executable
  3. ✓ Shebang is valid

Run "reins hook enable bash-guard" after fixing to re-enable.
```

**reins test integration** (verification command, `src/cli.ts`)

Two passes:

Pass 1 — Health check (per hook script in `.reins/hooks/`):
- Script file exists and is executable
- All CLI tools referenced in the script are in PATH (`jq`, `git`, `curl`, etc. — detected by scanning script for common tool names)
- Script exits 0 when given `echo '{}'` as input (clean baseline)

Pass 2 — Violation test (per hook that has a known check type):
- Construct a synthetic input that should trigger the hook's check (e.g. for `no-direct-sql`: a temp file containing `SELECT * FROM users`)
- Run the hook with that input as environment variables (simulating Claude Code's hook invocation format)
- Assert exit code is 2
- Report pass/fail per hook

```typescript
interface IntegrationTestResult {
  hookId: string;
  healthCheck: { passed: boolean; issues: string[] };
  violationTest: { passed: boolean; skipped: boolean; message: string };
}
```

**Data flow for a hook execution**:
```
Claude Code triggers hook event
  → isHookDisabled(hookId)?
      → true: skip execution, log warning to .reins/logs/
      → false: execute hook script
          → exit 0: recordHookResult(hookId, 'success')
          → exit 2: recordHookResult(hookId, 'success')  // intentional block, not an error
          → exit 1 / exception: recordHookResult(hookId, 'error', stderr)
```

Note: exit 2 (constraint violation, hook blocking the tool call) is a successful execution from the health monitor's perspective. Only unexpected failures (exit 1, missing binary, script crash) count as errors.

## Key Decisions

- **Exit 2 is a healthy result, not an error**: The health monitor tracks whether the hook script ran successfully, not whether it allowed or blocked the operation. A hook correctly blocking a `force push` should count as a success.
- **Auto-disable mutates `settings.json` directly**: Rather than introducing a separate "disabled list" file, the hook is simply removed from `settings.json` so Claude Code never calls it. This is the most direct path to preventing further invocations. `settings-writer.ts` consults `hook-health.yaml` on regeneration to keep disabled hooks out.
- **`reins hook fix` is read-only and diagnostic**: It never modifies hook scripts automatically. Auto-repair of shell scripts is fragile; human review is safer. The command provides enough information to fix manually in under a minute.
- **Violation tests use synthetic inputs, not real project state**: Real project files may or may not contain violations at test time. Synthetic inputs guarantee the check fires deterministically and the test is repeatable.
- **health_threshold defaults to 5, configurable in config.yaml**: Five consecutive errors distinguishes a broken script from a transient environment issue. Lower values risk false disables; higher values mean a broken hook runs more times before being stopped.

## File Structure

```
src/hooks/health-monitor.ts    # HookHealth interface, recordHookResult, load/save, disable
```
