## Tasks

- [ ] **Task 1: Implement `reins status`**
  - Description: Create `src/commands/status.ts`. Implement log reading from `.reins/logs/*.jsonl` with `--since` duration parsing (e.g. "7d", "24h"). Aggregate violation counts and compute trend. Build suggestion list. Implement three output formatters: human (default table), json, markdown. Register `reins status [--filter] [--format] [--since]` in `src/cli.ts`.
  - Files: `src/commands/status.ts`, `src/cli.ts`
  - Tests: Unit test log aggregation with fixture log entries; test trend calculation (up/down/stable); test each formatter produces correct output shape; test `--since` correctly filters entries.
  - Done when: `reins status` prints a constraint table with violation counts and at least one suggestion when violations exist; all three formats produce valid output.

- [ ] **Task 2: Implement `reins update`**
  - Description: Create `src/commands/update.ts`. Load previous manifest, build current manifest, diff them. If no changes, exit early. Otherwise, rescan only the changed file paths using the scanner's path-filter option. Call `mergeConstraints` with the existing and new constraints. Present the `MergeResult` diff to the user for confirmation (or auto-apply if `--auto-apply` and confidence >= 90). Save snapshot, write constraints, save manifest. Register `reins update [--auto-apply]` in `src/cli.ts`.
  - Files: `src/commands/update.ts`, `src/cli.ts`
  - Tests: Unit test the "no changes" early-exit path; test that `--auto-apply` only applies items with confidence >= 90; integration test that running update on a project with a changed file produces a new snapshot and updated `constraints.yaml`.
  - Done when: `reins update` correctly identifies changed files, shows a diff, and updates `constraints.yaml` after user confirmation; `--auto-apply` works as specified.

- [ ] **Task 3: Implement `reins test`**
  - Description: Create `src/commands/test.ts`. Read all hook scripts from `.reins/hooks/`. For each hook, parse the `hook_check` pattern from `constraints.yaml` to construct synthetic pass/fail inputs. Execute the hook script with each input, capture exit code, classify result. Print results table. Exit with code 1 if any hook is `broken`. Register `reins test` in `src/cli.ts`.
  - Files: `src/commands/test.ts`, `src/cli.ts`
  - Tests: Unit test result classification (healthy/broken/disabled) for each combination of syntheticPass and syntheticFail outcomes; test that exit code is 1 when any hook is broken and 0 when all are healthy.
  - Done when: `reins test` executes all hooks, reports their health status in a table, and exits non-zero on any broken hook.

- [ ] **Task 4: Implement `reins rollback`**
  - Description: Create `src/commands/rollback.ts`. Without `--to`: list snapshots with index numbers, prompt user to select. With `--to <id>`: validate id. In both paths: save a pre-rollback snapshot, call `restoreSnapshot`, print restored file list. Register `reins rollback [--to]` in `src/cli.ts`.
  - Files: `src/commands/rollback.ts`, `src/cli.ts`
  - Tests: Unit test that pre-rollback snapshot is saved before restore; test that `--to` with an invalid id exits with an error message; integration test that files are correctly restored after rollback.
  - Done when: `reins rollback` restores files from the selected snapshot; a pre-rollback snapshot is always created; invalid snapshot ids produce a clear error.

- [ ] **Task 5: Implement `reins hook` sub-commands**
  - Description: Create `src/commands/hook.ts`. Implement `add`: call LLM with the description, write generated script to `.reins/hooks/`, update `constraints.yaml`, save snapshot. Implement `list`: read hooks dir and constraints.yaml, print table. Implement `disable`: set `hook_mode: off` in constraints.yaml for the specified id. Implement `fix`: run health check, for broken hooks send script + error to LLM, show diff and prompt for approval, apply if confirmed. Implement `promote`: find constraint, prompt for hook type, generate script via LLM, update constraints.yaml. Register `reins hook <sub-command>` in `src/cli.ts`.
  - Files: `src/commands/hook.ts`, `src/cli.ts`
  - Tests: Unit test `disable` correctly sets `hook_mode: off` without touching other fields; unit test `list` output format; integration test `add` creates a hook script file and updates constraints.yaml; test `fix` does not apply changes without user confirmation.
  - Done when: All five sub-commands work end-to-end; `hook add` and `hook fix` do not write anything without user-visible output; `hook disable` is idempotent.
