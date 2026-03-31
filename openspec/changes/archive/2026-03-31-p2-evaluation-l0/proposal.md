## Why

The pipeline has no feedback signal for whether code is correct after execution. Without a static check layer, the Ralph review loop has no deterministic exit condition and the QA stage cannot verify basic correctness. L0 is the cheapest and most universal check — it runs the project's own lint, typecheck, and test scripts and costs nothing to set up.

## What Changes

- Add `src/evaluation/evaluator.ts` as the unified evaluation entry point; Phase 2 only wires L0
- Add `src/evaluation/l0-static.ts` to auto-detect project commands from `package.json` scripts, run them in sequence, and capture output with pass/fail status per command
- Add `src/evaluation/exit-condition.ts` to implement the `shouldExit()` function used by the Ralph loop; Phase 2 exit condition: `L0_passed == true` (matches `relaxed` profile minimum)
- Command detection: check `package.json` scripts for `lint`, `typecheck`/`type-check`/`tsc`, `test`/`test:ci` in that order; fall back to common tool invocations if not found
- Capture stdout + stderr per command; report structured `L0Result` with per-command pass/fail and aggregated `passed: boolean`

## Capabilities

### New Capabilities

- `l0-static-check`: Detects and runs lint, typecheck, and test commands from the project's `package.json` scripts; returns a structured result with per-command output and overall pass/fail
- `exit-condition`: `shouldExit(evalResult, profile)` returns `{ exit: boolean, reason: string }` based on evaluation results and the active profile's `exit_when` expression; Phase 2 implements `L0_passed` condition only
- `evaluation-entry`: `src/evaluation/evaluator.ts` exports `evaluate(projectRoot, profile)` as the single function the pipeline calls; routes to the appropriate layer(s) based on profile

### Modified Capabilities

None — this is a new module with no prior implementation.

## Impact

- Depends on `mvp-scanner-core` for project environment detection (detecting whether `package.json` exists and what package manager is in use)
- `exit-condition.ts` exports the `ExitCondition` interface and `shouldExit()` function; `p2-pipeline-runner`'s RALPH stage imports this to decide when to stop iterating
- L0 commands run in `projectRoot` with the detected package manager (`pnpm`/`npm`/`yarn`); a missing script is skipped with a warning, not treated as failure
- Phase 3 will add L1 coverage gate; Phase 4 adds L2 and L4; `evaluator.ts` is designed to route to additional layers without interface changes
