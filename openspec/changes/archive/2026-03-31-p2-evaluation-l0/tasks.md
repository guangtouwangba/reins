## Tasks

- [ ] **Task 1: Implement `l0-static.ts` — command detection**
  - Description: Write `detectCommands(projectRoot: string): DetectedCommands`. Read `package.json` from `projectRoot`. Detect package manager from lockfile presence (`pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, else npm). For each of the three categories (lint, typecheck, test), check for the candidate script keys in order: lint checks `['lint', 'lint:check', 'eslint']`; typecheck checks `['typecheck', 'type-check', 'tsc', 'check']`; test checks `['test', 'test:ci', 'vitest', 'jest']`. If a matching key exists and its value does not start with `echo` and is non-empty, use `<pm> run <key>` as the command. If no key matches, set `command: null` (will be skipped). Return `DetectedCommands: { packageManager, lint, typecheck, test }` where each field is `{ command: string | null, scriptKey: string | null }`.
  - Files: `src/evaluation/l0-static.ts`
  - Tests: Test with a fixture `package.json` that has `lint` and `test` but no typecheck — verify typecheck command is null; test with `pnpm-lock.yaml` present — verify `packageManager` is `pnpm`; test with an `echo`-prefixed script — verify it is treated as missing
  - Done when: All three categories are detected correctly; package manager detection works for pnpm/yarn/npm; echo scripts are skipped; `DetectedCommands` is returned

- [ ] **Task 2: Implement `l0-static.ts` — command execution**
  - Description: Write `runCommand(name, command, cwd): Promise<CommandResult>` using `child_process.exec` with a 60-second timeout and `cwd` set to `projectRoot`. Capture stdout and stderr. Record `durationMs`. Return `CommandResult: { name, command, exitCode, stdout, stderr, durationMs, skipped: false }`. Write `runL0Static(projectRoot: string): Promise<L0Result>` that calls `detectCommands`, then runs each non-null command in sequence. If `command` is null, push a `CommandResult` with `skipped: true, exitCode: 0`. Stop after first failure if `l0FailFast` is true (default true). Return `L0Result: { passed, commands, detectedPackageManager }`.
  - Files: `src/evaluation/l0-static.ts`
  - Tests: Test `runCommand` with `echo hello` — verify exitCode 0 and stdout contains "hello"; test with `exit 1` — verify exitCode 1; test that `runL0Static` stops after first failure when failFast is true; test that a null command produces a skipped result
  - Done when: Commands run with correct CWD; timeout is set; skipped commands are represented correctly; fail-fast behavior works; `L0Result` is returned with correct `passed` field

- [ ] **Task 3: Implement `exit-condition.ts`**
  - Description: Define `ExitCondition` interface: `{ L0_passed, L1_passed, L2_passed, L3_passed, L4_confidence, iterationCount, maxIterations }`. Write `shouldExit(condition: ExitCondition, profile: string): { exit: boolean, reason: string }`. Implement the four profile expressions from `modules/07-evaluation.md`. Always check max iterations first — if `iterationCount >= maxIterations`, return `{ exit: true, reason: 'max iterations reached' }`. Write `buildExitCondition(evalResult: EvalResult, iterationCount: number, config: ReinsConfig): ExitCondition` that maps evaluation results to the condition object; Phase 2 sets `L1_passed = true`, `L2_passed = true`, `L3_passed = true`, `L4_confidence = 100` as stubs for unimplemented layers.
  - Files: `src/evaluation/exit-condition.ts`
  - Tests: Test `shouldExit` for each profile with passing and failing L0; test max iterations returns exit regardless of L0; test `relaxed` profile exits when L0 passes even if L1 is false; test `buildExitCondition` maps `L0Result.passed` correctly
  - Done when: All four profile expressions are implemented; max iterations check fires first; stubs return non-blocking values for L1–L4; tests pass for all profile cases

- [ ] **Task 4: Implement `evaluator.ts` — unified evaluation entry**
  - Description: Write `evaluate(projectRoot: string, profile: string): Promise<EvalResult>`. Call `runL0Static(projectRoot)` and assemble `EvalResult: { l0: L0Result, l1: null, l2: null, l3: null, l4: null }`. Export `EvalResult` interface. This is the only function the pipeline calls — the pipeline does not import `l0-static.ts` directly.
  - Files: `src/evaluation/evaluator.ts`
  - Tests: Integration test that calls `evaluate()` on a fixture project with a passing `echo ok` test script — verify `l0.passed` is true; verify `l1`–`l4` are null
  - Done when: `evaluate()` returns a complete `EvalResult`; L0 is wired; higher layers are null; function is the sole public export of the evaluation module

- [ ] **Task 5: Connect evaluator to pipeline exit condition**
  - Description: In `src/pipeline/runner.ts` (from `p2-pipeline-runner`), import `evaluate` from `src/evaluation/evaluator.ts` and `buildExitCondition`, `shouldExit` from `src/evaluation/exit-condition.ts`. In the RALPH stage stub, call `evaluate(projectRoot, profile)` and `shouldExit(buildExitCondition(evalResult, 0, config), profile)`. Log the exit condition result to the stage output. This wires L0 results into the pipeline even though the RALPH loop itself is a stub in Phase 2.
  - Files: `src/pipeline/runner.ts`
  - Tests: Integration test that a project with a failing lint command causes the RALPH stage to report `L0_passed: false` in its output
  - Done when: `runner.ts` calls `evaluate()` in the RALPH stage; exit condition is computed and logged; a failing L0 produces `L0_passed: false` in the stage result
