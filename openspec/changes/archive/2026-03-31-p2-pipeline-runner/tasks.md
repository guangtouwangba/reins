## Tasks

- [ ] **Task 1: Define shared types and interfaces**
  - Description: Create a `src/pipeline/types.ts` file with all shared interfaces for the pipeline module: `PipelineOpts`, `PipelineResult`, `StageResult`, `StageLog`, `ExecutionRecord`, `QAResult`, `CommandResult`, `Plan`, `ExecutionResult`, `ReviewResult`, `InjectionContext`, `HookConfig`, `Profile`. These types are referenced by all other pipeline sub-modules. Keep them minimal — only fields actually used in Phase 2 implementation.
  - Files: `src/pipeline/types.ts`
  - Tests: No runtime behavior; verify TypeScript compilation succeeds with `tsc --noEmit`
  - Done when: All interfaces are defined and exported; no TypeScript errors; other pipeline modules can import from this file

- [ ] **Task 2: Implement `constraint-injector.ts`**
  - Description: Write `injectConstraints(task: string, ctx: InjectionContext): string`. Implement `filterByProfile(constraints, profile)` with the four profile cases: `all`, `critical`, `default` (critical+important), and array-based custom. Return a multi-section markdown string containing: task description, numbered active constraint list with severity tags, block-mode hook list, and stage sequence. This string is prepended verbatim to all downstream prompts.
  - Files: `src/pipeline/constraint-injector.ts`
  - Tests: Unit test `filterByProfile` with each profile value; unit test that `injectConstraints` output contains the task string, the correct number of constraints, and the stage sequence; snapshot test the output format
  - Done when: `filterByProfile` correctly filters for all four profiles; `injectConstraints` returns a non-empty string containing all expected sections; tests pass

- [ ] **Task 3: Implement `omc-bridge.ts` — Phase 2 stub**
  - Description: Define the `OMCBridge` interface with three methods: `ralplan(prompt: string): Promise<Plan>`, `executor(prompt: string, opts: ExecOpts): Promise<ExecutionResult>`, `ralph(prompt: string, maxIter: number): Promise<ReviewResult>`. Implement a `StubOMCBridge` class where each method logs the first 200 chars of the prompt and returns a stub result object (not throws). Stub results: `ralplan` returns `{ steps: [], files: [], verificationCases: [] }`; `executor` returns `{ success: true, filesCreated: [], filesModified: [], output: 'stub' }`; `ralph` returns `{ success: true, iterations: 0, issues: [] }`. Export the stub as the default.
  - Files: `src/pipeline/omc-bridge.ts`
  - Tests: Verify each stub method resolves (does not reject); verify the interface is structurally correct by using it as the `OMCBridge` type
  - Done when: All three methods return stub results without throwing; interface is exported; stub is the default export

- [ ] **Task 4: Implement `qa.ts` — QA quality gate**
  - Description: Write `runQA(projectRoot: string, config: ReinsConfig): Promise<QAResult>`. Read `config.pipeline?.pre_commit ?? []` and `config.pipeline?.post_develop ?? []`, concatenate them, and run each command sequentially via `child_process.exec` with `cwd: projectRoot`. Stop on first failure (`exitCode !== 0`). Record `durationMs` for each command. Return `QAResult` with `passed: boolean` and `results: CommandResult[]`. If the combined command list is empty, return `{ passed: true, results: [] }` immediately.
  - Files: `src/pipeline/qa.ts`
  - Tests: Test with a passing command (`echo ok`); test with a failing command (`exit 1`); test with an empty config (returns passed immediately); test that commands run in `projectRoot` CWD
  - Done when: QA runs and stops on first failure; empty config returns passed; `durationMs` is populated for each result; tests pass

- [ ] **Task 5: Implement `execution-logger.ts`**
  - Description: Write `logExecution(projectRoot: string, record: ExecutionRecord): string`. Determine the output path as `.reins/logs/executions/<YYYY-MM-DD>-<NNN>.yaml` where `NNN` is the zero-padded count of existing files for that date plus one. Create the directory recursively if it does not exist. Serialize the record to YAML using `js-yaml` and write it. Return the full path to the written file.
  - Files: `src/pipeline/execution-logger.ts`
  - Tests: Write two records in sequence and verify they get sequence numbers `001` and `002`; verify the YAML file is valid and contains the task field; verify the directory is created if absent
  - Done when: Log files are written with correct naming; sequence numbers increment correctly per date; YAML is valid; tests pass

- [ ] **Task 6: Implement `runner.ts` — pipeline orchestrator**
  - Description: Write `runPipeline(task: string, projectRoot: string, opts: PipelineOpts): Promise<PipelineResult>`. Load config, load constraints, call `injectConstraints()` for HARNESS_INIT, then run each remaining stage in order. For each stage: call `opts.onStageChange?.(stage, 'start')`, execute the stage function, call `opts.onStageChange?.(stage, 'complete'|'skip')`. Skip stages based on profile rules and `opts.skipStages`. Catch stage failures and short-circuit. Call `logExecution()` at the end. Return `PipelineResult: { success, failedStage?, error?, logPath, durationMs }`.
  - Files: `src/pipeline/runner.ts`
  - Tests: Integration test with `skipStages: ['ralplan', 'ralph']` and a passing QA (mock `runQA` to return passed); verify `onStageChange` is called for each non-skipped stage; verify log file is written; verify `relaxed` profile skips ralplan, ralph, qa
  - Done when: Pipeline runs all non-skipped stages in order; `onStageChange` callback is invoked correctly; log is written; `PipelineResult` is returned with correct fields; tests pass
