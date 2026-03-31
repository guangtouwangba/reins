## Tasks

- [ ] **Task 1: Implement environment-manager.ts**
  - Description: Define `EnvironmentConfig`, `DependencyConfig`, `DatabaseConfig` interfaces. Implement `EnvironmentManager` class with `prepare()` (check each dependency via its `check` command, run `setup` if needed, reset and seed database), `start()` (spawn service process, poll `health_check` URL every 500ms up to `startup_timeout`, resolve when 200 received), and `teardown()` (kill process, optionally run dependency teardown commands). All lifecycle errors must be surfaced as structured errors, not unhandled rejections.
  - Files: `src/evaluation/environment-manager.ts`
  - Tests: Unit test `prepare()` with a mock dependency that needs setup; test `start()` resolves when health check returns 200; test `start()` rejects after timeout; test `teardown()` is called even when `start()` throws.
  - Done when: `EnvironmentManager` is exported, all three methods handle error cases, and unit tests pass.

- [ ] **Task 2: Implement verification-runner.ts**
  - Description: Implement `loadVerificationCases(projectRoot)` that reads all `*.yaml` files in `.reins/verification-cases/`, filters to `type: api` cases. Implement `runVerificationCases(projectRoot, baseUrl, authToken?)` that for each case builds a `curl` command (method, URL, headers, body), executes it via `child_process.execSync`, compares response status and body against `expect`, and writes `passes: true` or `passes: false` back into the YAML file. Implement `{{auth_token}}` template substitution before execution.
  - Files: `src/evaluation/verification-runner.ts`
  - Tests: Unit test `loadVerificationCases` reads and parses YAML correctly; test a passing case (mock curl returning expected status) sets `passes: true`; test a failing case sets `passes: false`; test `{{auth_token}}` substitution in headers and body; test that `type: e2e` cases are skipped.
  - Done when: All cases in `verification-cases/` are executed, `passes` field is written back to each file, and unit tests pass.

- [ ] **Task 3: Implement l2-integration.ts**
  - Description: Implement `runIntegrationVerify(projectRoot)`. First check whether `.reins/verification.yaml` exists; if not, return `{ passed: true, skipped: true }`. Load `verification.yaml`, instantiate `EnvironmentManager`, call `prepare()` + `start()`, obtain auth token if configured (run the `auth.obtain` command), call `runVerificationCases()`, call `teardown()` in a `finally` block, and return `L2Result` with pass/fail aggregation.
  - Files: `src/evaluation/l2-integration.ts`
  - Tests: Unit test that missing `verification.yaml` returns skipped result; test that `teardown()` is called even when cases throw; test that `L2Result.passed` is false when any case has `passes: false`; integration test (marked slow) against a minimal Express server fixture.
  - Done when: `runIntegrationVerify` is exported, teardown always runs, skipped result returned when no recipe, and unit tests pass.

- [ ] **Task 4: Implement l1-coverage.ts**
  - Description: Implement `runCoverageGate(projectRoot, stagedFiles)` running all five checks in sequence. For `branch_coverage`: invoke `pnpm test --coverage --reporter=json` on staged file paths only, parse the JSON coverage output, and compute branch coverage ratio for each new file. If the test runner does not support coverage flags, return a skipped result for this check only. For the other four checks, use file-system reads and regex patterns—no test runner invocation needed.
  - Files: `src/evaluation/l1-coverage.ts`
  - Tests: Unit test each of the five checks independently with fixture files; test that a missing test file fails `new_file_has_test`; test that `test.skip` fails `no_empty_tests`; test that coverage below 70% fails `branch_coverage`; test that a catch block with no test fails `error_path_tested`; test that `vi.mock('./src/mymodule')` fails `mock_audit`.
  - Done when: All five checks run, each returns a structured result with a human-readable message, and unit tests cover pass and fail cases for each check.

- [ ] **Task 5: Wire L1 and L2 into evaluator and exit-condition**
  - Description: In `src/evaluation/exit-condition.ts`, add `L1_passed: boolean` and `L2_passed: boolean` to `ExitCondition`. Update `shouldExit()` so `default` profile requires `L0_passed && L1_passed` and `strict` profile requires `L0_passed && L1_passed && L2_passed`. In `src/evaluation/evaluator.ts`, call `runCoverageGate` after L0 passes (for `default` and `strict` profiles) and call `runIntegrationVerify` after L1 passes (for `strict` profile only).
  - Files: `src/evaluation/evaluator.ts`, `src/evaluation/exit-condition.ts`
  - Tests: Test that `shouldExit` for `default` returns false when L1 has not passed; test `strict` requires all three; test that evaluator short-circuits and does not run L2 when L1 fails.
  - Done when: `ExitCondition` type updated, `shouldExit` logic correct for all four profiles, evaluator calls layers in order, and tests pass.

- [ ] **Task 6: Add verification recipe generation to reins init**
  - Description: In the `reins init` flow, after environment-detector runs, call `verificationRecipeGenerate(projectRoot, envDetectorResult)` to write `.reins/verification.yaml`. Fields that cannot be detected are written as commented-out `# TODO` placeholders. Also add `generateVerificationCaseStub(projectRoot, taskSlug, acceptanceCriteria)` used by the planning stage to produce `verification-cases/<task-slug>.yaml` stubs with `passes: false`.
  - Files: `src/evaluation/l2-integration.ts` (export the generators), `src/cli.ts` (wire into init)
  - Tests: Test `verificationRecipeGenerate` with a full env-detector result writes a valid YAML; test with partial result writes TODO placeholders; test `generateVerificationCaseStub` writes correct YAML with `passes: false`.
  - Done when: `reins init` on a detected project produces `.reins/verification.yaml`; planning stage can call the stub generator; tests pass.
