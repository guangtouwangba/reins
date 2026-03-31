## Approach

Implement the pipeline as a linear sequence of async stage functions, each receiving the constraint-injected context string produced by HARNESS_INIT. The runner calls stages in order, short-circuits on failure, and logs the result. The OMC bridge is a typed interface with stub implementations in Phase 2 — real OMC calls are wired incrementally in Phase 3 and 4.

## Architecture

**Runner** (`src/pipeline/runner.ts`):
- `runPipeline(task, projectRoot, opts: PipelineOpts): Promise<PipelineResult>` is the single entry point
- `PipelineOpts`: `{ profile: 'default' | 'strict' | 'relaxed', skipStages: string[] }`
- Stage sequence: `harnessInit → ralplan → execution → ralph → qa`; each stage is called only if not in `skipStages` and not excluded by profile
- `relaxed` profile skips `ralplan`, `ralph`, `qa`
- Each stage returns `StageResult: { success: boolean, duration: number, output: string, error?: string }`; on `success: false` the runner stops and returns a failed `PipelineResult`
- Calls `executionLogger.write()` at the end regardless of success/failure

**Constraint injector** (`src/pipeline/constraint-injector.ts`):
- `injectConstraints(task, config: InjectionContext): string` — the only exported function
- `InjectionContext`: `{ profile: Profile, constraints: Constraint[], hooks: HookConfig[], pipeline: PipelineConfig }`
- `filterByProfile(constraints, profile)`: `'all'` returns everything; `'critical'` returns severity=critical only; `'default'` returns critical+important; custom profiles read an array from `profile.constraints`
- Returns a multi-section markdown string: task description, active constraint list with severity tags, active block-mode hooks list, and pipeline stage sequence — this string is prepended to every downstream prompt

**OMC bridge** (`src/pipeline/omc-bridge.ts`):
- `OMCBridge` interface: `{ ralplan(prompt): Promise<Plan>, executor(prompt, opts): Promise<ExecutionResult>, ralph(prompt, maxIter): Promise<ReviewResult> }`
- Phase 2 stub implementation: each method logs the prompt prefix, then throws `NotImplementedError` with a message explaining the phase — the runner catches this and marks the stage as skipped rather than failed, so the pipeline can still run HARNESS_INIT + QA end-to-end
- The stub is the default export; real implementations will replace it in Phase 3

**QA** (`src/pipeline/qa.ts`):
- `runQA(projectRoot, config: ReinsConfig): Promise<QAResult>`
- Reads `config.pipeline.pre_commit` and `config.pipeline.post_develop` arrays; concatenates them in order
- Runs each command via `child_process.exec` with `cwd: projectRoot`; stops at first failure
- `QAResult`: `{ passed: boolean, results: CommandResult[] }` where `CommandResult`: `{ command, success, output, error, durationMs }`
- If both arrays are empty, returns `{ passed: true, results: [] }` — QA is a no-op when not configured

**Execution logger** (`src/pipeline/execution-logger.ts`):
- `logExecution(projectRoot, record: ExecutionRecord): string` — writes to `.reins/logs/executions/<YYYY-MM-DD>-<seq>.yaml`, returns the log file path
- `ExecutionRecord`: `{ id, task, profile, durationSeconds, outcome, stages: Record<string, StageLog>, constraintsChecked, constraintsViolated, violations[] }`
- Creates the directory if it does not exist
- Sequence number is determined by counting existing files in the directory for that date (zero-padded to 3 digits)

## Key Decisions

- **Stub OMC bridge that skips rather than fails**: Phase 2 goal is a working pipeline skeleton. If the RALPLAN or RALPH stubs threw fatal errors, no end-to-end pipeline run would be possible until Phase 3. Skipping with a log entry lets QA run and produces real execution logs from day one.
- **Profile drives stage selection, not a skip list alone**: `--skip qa` is additive on top of profile-based skipping. This means `relaxed` always omits RALPH even if the user doesn't pass `--skip`; they don't need to know internal stage names.
- **Constraint injector returns a plain string**: The injected context is prepended to prompts as markdown text, not structured data. This keeps the bridge interface simple and works with any OMC agent regardless of how it receives its system prompt.
- **QA runs project commands, not reins evaluation**: QA in Phase 2 is just the `pre_commit`/`post_develop` shell commands the project owner configured. The L0 evaluator integration (from `p2-evaluation-l0`) is wired into the RALPH stage exit condition, not QA — QA is a final gate, not a feedback loop.
- **Single log file per pipeline run**: One YAML file per execution keeps logs browsable with `ls` and readable with any YAML tool. The timestamp prefix makes them naturally sorted.

## File Structure

```
src/pipeline/
├── runner.ts                 # runPipeline(task, projectRoot, opts): PipelineResult
├── constraint-injector.ts    # injectConstraints(task, ctx: InjectionContext): string
├── omc-bridge.ts             # OMCBridge interface + Phase 2 stub implementation
├── qa.ts                     # runQA(projectRoot, config): QAResult
└── execution-logger.ts       # logExecution(projectRoot, record): string

.reins/logs/executions/       # generated output (gitignored, personal)
    ├── 2026-03-31-001.yaml
    └── ...
```
