## Tasks

- [ ] **Task 1: Implement HookHealth interface and core health-monitor functions**
  - Description: In `src/hooks/health-monitor.ts`, define the `HookHealth` interface (`hookId`, `consecutiveErrors`, `lastError`, `lastSuccess`, `disabled`, `disabledReason`). Implement `loadHookHealth(projectRoot, hookId)` that reads `.reins/logs/hook-health.yaml` and returns the entry for the given hookId, or a default zero-state object if not present. Implement `saveHookHealth(projectRoot, hookId, health)` that writes the updated entry back to the YAML. Implement `getAllHookHealth(projectRoot)` returning all entries. Implement `isHookDisabled(projectRoot, hookId)` as a convenience wrapper.
  - Files: `src/hooks/health-monitor.ts`
  - Tests: Unit test `loadHookHealth` returns default state for unknown hookId; test `saveHookHealth` creates the file if absent; test round-trip load/save preserves all fields; test `isHookDisabled` returns true only when `disabled: true`.
  - Done when: All four functions exported, YAML file is created on first save, and unit tests pass.

- [ ] **Task 2: Implement recordHookResult and auto-disable logic**
  - Description: Implement `recordHookResult(projectRoot, hookId, result, error?)`. On `success`: reset `consecutiveErrors` to 0, update `lastSuccess`. On `error`: increment `consecutiveErrors`, set `lastError`; if `consecutiveErrors >= config.hooks.health_threshold` (default 5), set `disabled: true`, set `disabledReason`, and call `disableHookInSettings(projectRoot, hookId)`. Implement `disableHookInSettings` that reads `.claude/settings.json`, removes all hook entries whose `command` path contains the hookId string, and writes the file back.
  - Files: `src/hooks/health-monitor.ts`
  - Tests: Unit test that 4 consecutive errors does not disable; test that 5 consecutive errors sets `disabled: true` and calls settings mutation; test that a success after 4 errors resets `consecutiveErrors` to 0; test `disableHookInSettings` removes the correct entry and leaves others intact; test that exit-2 results are passed as `'success'` not `'error'`.
  - Done when: `recordHookResult` exported, auto-disable fires at threshold, settings mutation removes hook correctly, and unit tests pass.

- [ ] **Task 3: Implement reins hook fix command**
  - Description: In `src/cli.ts`, add the `reins hook fix` subcommand. It calls `getAllHookHealth(projectRoot)`, filters to `disabled: true` entries, and for each: reads the hook script content, runs five diagnostics (shebang check, `jq`/`git` availability via `which`, referenced file existence, executable bit, dry-run with `echo '{}' | <script>`), and prints a formatted report with numbered findings and concrete fix suggestions. Also print `reins hook enable <hookId>` as the recovery command at the end of each hook's report.
  - Files: `src/cli.ts`
  - Tests: Unit test that a hook with missing `jq` produces a diagnostic finding mentioning `jq`; test that a non-executable script produces an executable-bit finding; test that a hook with no issues prints a clean report; test output format includes the `reins hook enable` recovery line.
  - Done when: `reins hook fix` runs without error, produces useful output for common failure modes, and unit tests cover the main diagnostic branches.

- [ ] **Task 4: Implement reins test integration command**
  - Description: In `src/cli.ts`, add the `reins test integration` subcommand. Pass 1 (health check): for each `.sh` file in `.reins/hooks/`, check it is executable, scan for tool names (`jq`, `git`, `curl`, `pg_isready`) and verify each is in PATH via `which`, run the script with `echo '{}' | <script>` and assert exit 0. Pass 2 (violation test): for each hook that has a recognizable check type (detected by scanning the script for known patterns like `no-direct-sql`, `bash-guard` force-push pattern, etc.), construct a synthetic input and assert exit 2. Print a pass/fail table per hook with two columns (health, violation).
  - Files: `src/cli.ts`
  - Tests: Unit test pass-1 reports a failure for a non-executable script; test pass-1 reports a missing-tool failure when a required binary is absent; test pass-2 correctly identifies a violation and asserts exit 2; test the output table format includes both columns.
  - Done when: `reins test integration` runs both passes, prints a clear table, returns non-zero exit code if any check fails, and unit tests pass.
