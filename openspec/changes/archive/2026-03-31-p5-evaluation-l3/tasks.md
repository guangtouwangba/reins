## Tasks

- [ ] **Task 1: Extend environment-manager with Docker Compose startup**
  - Description: Add `startDependencies(deps: ExternalDependency[], projectRoot: string): Promise<void>` to `environment-manager.ts`. For each dependency with a `setup` command, run it via `execa`. Poll the dependency's `check` command (max 30 attempts, 1s interval) until it exits 0. Fail with a clear error if any dependency does not become ready within the timeout. Add `teardownDependencies(deps)` that runs each `teardown` command.
  - Files: `src/evaluation/environment-manager.ts`
  - Tests: Unit test with a mock dependency that succeeds on poll attempt 3; unit test with a dependency that never becomes ready (should reject after max attempts)
  - Done when: `startDependencies` resolves after polling passes; `teardownDependencies` runs teardown commands; both unit tests pass; `tsc --noEmit` reports 0 errors

- [ ] **Task 2: Create L3 entry point (`l3-e2e.ts`)**
  - Description: Create `src/evaluation/l3-e2e.ts`. Export `runL3(casePaths: string[], env: RunningEnvironment): Promise<L3Result>`. Load each case file with `js-yaml`. Filter to cases where `type === 'e2e'`. For each case call `E2ERunner.execute(case, env.baseUrl)`. Aggregate step results into `CaseResult[]`. Return `{ passed: boolean, cases: CaseResult[], screenshots: string[] }`. Define `L3Result` and `E2ECase` interfaces in this file.
  - Files: `src/evaluation/l3-e2e.ts`
  - Tests: Unit test with two mock cases (one passing, one failing) — verify `passed` is false when any case fails; verify `screenshots` accumulates paths from both cases
  - Done when: Interfaces defined; aggregation logic correct; `tsc --noEmit` 0 errors

- [ ] **Task 3: Create E2E runner (`e2e-runner.ts`)**
  - Description: Create `src/evaluation/e2e-runner.ts`. Export `class E2ERunner` with `static async execute(case: E2ECase, baseUrl: string): Promise<CaseResult>`. Launch `chromium.launch({ headless: true })`. Iterate `case.steps[]` dispatching by `action`: navigate (`page.goto` + visibility assert), upload (`page.setInputFiles` + assert), click (`page.click` + assert with timeout), screenshot (`page.screenshot` to `.reins/logs/`). On step failure: capture failure screenshot to `.reins/logs/e2e-failure-<caseId>-<stepId>-<ts>.png`. Always close browser in `finally`. Define `StepResult` with `{ stepId, passed, error?, screenshotPath? }`.
  - Files: `src/evaluation/e2e-runner.ts`
  - Tests: Integration test using a minimal HTML fixture served by a local static server — navigate to it, assert a known selector is visible, assert the step passes; test that a missing selector causes step failure and writes a failure screenshot file
  - Done when: All four action types implemented; failure screenshot written on assertion error; browser closed in finally; integration tests pass

- [ ] **Task 4: Add optional screenshot baseline comparison**
  - Description: In `e2e-runner.ts`, after capturing a `screenshot` action, check if `.reins/fixtures/screenshots/<step.name>.png` exists. If it does, run a pixel diff using `pixelmatch` or `@playwright/test`'s snapshot comparison. If diff ratio exceeds `evaluation.e2e.screenshot_diff_threshold` (default 0.01), record a diff failure in `StepResult`. Respect `evaluation.e2e.screenshot_diff_blocking` (default false) — non-blocking means diff failure is recorded but does not fail the step.
  - Files: `src/evaluation/e2e-runner.ts`, `src/state/config.ts`
  - Tests: Unit test with a baseline image and a matching screenshot (diff = 0, passes); unit test with a mismatching screenshot exceeding threshold (non-blocking: step passes with warning; blocking: step fails)
  - Done when: Baseline comparison runs only when baseline file exists; non-blocking mode records diff without failing; blocking mode fails the step; config fields added to `ReinsConfig`

- [ ] **Task 5: Extend verification-runner to dispatch L3 cases**
  - Description: In `verification-runner.ts`, after loading case files, partition them: cases with `type: 'e2e'` go to `l3Queue`, others go to `l2Queue`. Run `l2Queue` first. If L2 passes (or no L2 cases), run `l3Queue` via `runL3()`. Return combined `VerificationResult` with both L2 and L3 sub-results.
  - Files: `src/evaluation/verification-runner.ts`
  - Tests: Unit test with mixed case types — verify L2 cases are not passed to L3 runner and vice versa; verify L3 is skipped when L2 fails
  - Done when: Partitioning correct; L3 skipped on L2 failure; combined result returned; `tsc --noEmit` 0 errors

- [ ] **Task 6: Wire L3 result into evaluator and exit condition**
  - Description: In `evaluator.ts`, call `runL3()` when the active profile is `fullstack` and environment is running. Store `L3Result` in `EvaluationResult`. In `exit-condition.ts`, update the `fullstack` profile condition to require `L3_passed: true`. Update `ExitCondition` interface to include `L3_passed: boolean`.
  - Files: `src/evaluation/evaluator.ts`, `src/evaluation/exit-condition.ts`
  - Tests: Unit test `shouldExit` with `fullstack` profile where `L3_passed: false` — must return `{ exit: false }`; unit test where all conditions including `L3_passed: true` are met — must return `{ exit: true }`
  - Done when: `ExitCondition.L3_passed` typed; `fullstack` exit requires it; both unit tests pass

- [ ] **Task 7: Document E2E case YAML schema and update verification.yaml example**
  - Description: Add inline JSDoc to `l3-e2e.ts` interfaces documenting each field of `E2ECase` and `E2EStep`. Add a sample `verification-cases/example-e2e.yaml` fixture to the test fixtures directory showing all four action types. Update the `verification.yaml` example in project docs to show `environment.dependencies` with Docker Compose setup/teardown/check fields.
  - Files: `src/evaluation/l3-e2e.ts`, `test/fixtures/verification-cases/example-e2e.yaml`
  - Tests: The sample YAML parses without error through `runL3`'s YAML loader; schema validation rejects a case file missing required `steps` field
  - Done when: JSDoc present on all exported interfaces; sample YAML parses cleanly; schema validation test passes
