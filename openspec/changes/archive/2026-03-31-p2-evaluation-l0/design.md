## Approach

Implement L0 as a thin wrapper around the project's own toolchain: detect what commands exist in `package.json` scripts, run them in sequence via `child_process.exec`, capture output, and return a structured result. No new lint or test tooling is introduced — L0 is entirely parasitic on what the project already has.

## Architecture

**Evaluator entry** (`src/evaluation/evaluator.ts`):
- `evaluate(projectRoot: string, profile: string): Promise<EvalResult>` is the single exported function
- Phase 2: always runs L0; higher layers return `{ passed: true, skipped: true }` as stubs
- `EvalResult`: `{ l0: L0Result, l1: null, l2: null, l3: null, l4: null }`
- Passes `projectRoot` to `runL0Static()` and assembles the final result

**L0 static check** (`src/evaluation/l0-static.ts`):
- `runL0Static(projectRoot: string): Promise<L0Result>`
- `detectCommands(projectRoot)`: reads `package.json` scripts, builds an ordered command list:
  1. Lint: looks for `lint`, `lint:check`, `eslint` in scripts; falls back to `pnpm eslint .` if none found
  2. Typecheck: looks for `typecheck`, `type-check`, `tsc`, `check` in scripts
  3. Test: looks for `test`, `test:ci`, `vitest`, `jest` in scripts
  - Detects package manager from presence of `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`
  - A script key that exists but points to `echo` or is empty is treated as missing (not run)
- `runCommand(cmd, cwd): Promise<CommandResult>`: wraps `child_process.exec` with a 60s timeout; captures stdout + stderr; records `durationMs`
- Runs lint → typecheck → test in sequence; stops on first failure (configurable via `l0_fail_fast`, default `true`)
- `L0Result`: `{ passed: boolean, commands: CommandResult[], detectedPackageManager: string }`
- `CommandResult`: `{ name: 'lint'|'typecheck'|'test', command: string, exitCode: number, stdout: string, stderr: string, durationMs: number, skipped: boolean }`
- A command is `skipped: true` (not failed) if no matching script was found and no fallback is available

**Exit condition** (`src/evaluation/exit-condition.ts`):
- `ExitCondition` interface: `{ L0_passed: boolean, L1_passed: boolean, L2_passed: boolean, L3_passed: boolean, L4_confidence: number, iterationCount: number, maxIterations: number }`
- `shouldExit(condition: ExitCondition, profile: string): { exit: boolean, reason: string }`
- Profile expressions (from `modules/07-evaluation.md`):
  - `relaxed`: exits when `L0_passed`
  - `default`: exits when `L0_passed && L1_passed`
  - `strict`: exits when `L0_passed && L1_passed && L2_passed && L4_confidence >= 80`
  - `fullstack`: exits when all of the above plus `L3_passed`
- Always exits (with failure reason) when `iterationCount >= maxIterations`
- `buildExitCondition(evalResult: EvalResult, iterationCount: number, config: ReinsConfig): ExitCondition` constructs the condition object from evaluation results; Phase 2 sets `L1_passed = true` (stub) since L1 is not yet implemented

## Key Decisions

- **Script detection over hardcoded commands**: Different projects use `tsc`, `typecheck`, or `check` for the same operation. Detecting from `package.json` scripts means L0 works correctly on the first run without any user configuration.
- **Skip is not fail**: If a project has no test script, L0 still passes. Treating missing scripts as failures would make reins unusable on projects that simply don't have one of the three categories. The `skipped` field in `CommandResult` makes it visible in logs without blocking the pipeline.
- **60-second timeout per command**: Sufficient for lint and typecheck on medium codebases; test suites that exceed this need `--passWithNoTests` or a `test:ci` script. The timeout prevents a hanging test process from blocking the pipeline indefinitely.
- **L1–L4 as stubs returning passed**: Phase 2 only needs L0 to work. Returning `passed: true` for unimplemented layers ensures the exit condition for `relaxed` profile (L0 only) and allows `default` profile runs without errors — the pipeline won't iterate needlessly on a stub that always passes.
- **`buildExitCondition` as a separate function**: The exit condition evaluation is stateful (it needs iteration count from the caller) but the condition logic is pure. Separating construction from evaluation keeps `shouldExit` testable without mocking pipeline state.

## File Structure

```
src/evaluation/
├── evaluator.ts              # evaluate(projectRoot, profile): EvalResult
├── l0-static.ts              # runL0Static(projectRoot): L0Result + detectCommands()
└── exit-condition.ts         # shouldExit(condition, profile) + buildExitCondition()
```
