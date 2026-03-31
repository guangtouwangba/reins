## Why

L0 static checks catch syntax and type errors but give no signal on whether new code is actually tested or whether a running service satisfies its acceptance criteria. Phase 4 adds two deterministic evaluation layers—a coverage gate that enforces test discipline at the file level, and an integration verifier that executes structured acceptance cases against a real running environment.

## What Changes

- Add `src/evaluation/l1-coverage.ts` implementing five coverage checks: `new_file_has_test`, `no_empty_tests`, `branch_coverage >= 70%`, `error_path_tested`, `mock_audit`
- Add `src/evaluation/l2-integration.ts` orchestrating the full integration verify flow: prepare env → start service → execute cases → check results → cleanup
- Add `src/evaluation/verification-runner.ts` parsing `.reins/verification-cases/*.yaml` and executing each case via `curl` or Playwright, writing `passes: true/false` back to the case file
- Add `src/evaluation/environment-manager.ts` managing service lifecycle: dependency checks, database reset/seed, process start with health-check polling, and teardown
- Add `.reins/verification.yaml` schema and auto-generation logic in `reins init` using environment-detector output (start command, port, health endpoint, dependencies, database config)
- Auto-generate `.reins/verification-cases/*.yaml` stubs during planning stage from task acceptance criteria
- Extend `ExitCondition` in `src/evaluation/exit-condition.ts` to incorporate `L1_passed` and `L2_passed` fields
- Wire L1 and L2 into the evaluator entry point (`src/evaluation/evaluator.ts`) under `default` and `strict` profiles respectively

## Capabilities

### New Capabilities

- `coverage-gate`: Runs five file-level checks on staged changes—new source file has a corresponding `.test.ts`, no `test.skip`/`test.todo`/empty `expect()`, new-code branch coverage >= 70%, catch/error handlers have tests, mocks target only external dependencies
- `integration-verify`: Reads `verification.yaml` + all `verification-cases/*.yaml`, boots the project environment, executes each case as an HTTP call, and writes pass/fail results back to the YAML files for the Ralph loop exit-condition check
- `verification-recipe-generate`: During `reins init`, inspects the project via environment-detector and writes a complete `.reins/verification.yaml` covering start command, port, health endpoint, dependency checks, and database setup/teardown
- `verification-case-generate`: During the planning stage, produces `.reins/verification-cases/<task-slug>.yaml` stubs from task acceptance criteria, with `passes: false` markers that the Ralph loop polls

### Modified Capabilities

- `evaluator`: Updated to run L1 after L0 (default + strict profiles) and L2 after L1 (strict profile only); L2 is skipped when no `verification.yaml` exists
- `exit-condition`: Extended with `L1_passed` and `L2_passed` boolean fields; `default` profile exit requires both L0 and L1; `strict` requires L0 + L1 + L2

## Impact

- New source files: `src/evaluation/l1-coverage.ts`, `src/evaluation/l2-integration.ts`, `src/evaluation/verification-runner.ts`, `src/evaluation/environment-manager.ts`
- Modified source files: `src/evaluation/evaluator.ts`, `src/evaluation/exit-condition.ts`
- Runtime: L2 requires `curl` and optionally `docker compose` (for dependency setup); no new npm dependencies
- `mvp-scanner-core` environment-detector output is consumed by `verification-recipe-generate`; scanner must run before `reins init` generates `verification.yaml`
- `.reins/verification.yaml` and `.reins/verification-cases/` are committed to git (team-shared acceptance criteria)
- `.reins/logs/verification/` is gitignored (runtime output)
