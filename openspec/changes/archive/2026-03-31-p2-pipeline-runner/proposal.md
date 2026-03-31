## Why

Running `reins develop` today has no structure — there is no constraint injection, no planning stage, no review loop, and no quality gate. Tasks complete without any guarantee that project constraints were observed, producing output that immediately violates the rules reins was set up to enforce.

## What Changes

- Add `src/pipeline/runner.ts` as the top-level orchestrator for the 5-stage pipeline: HARNESS_INIT → RALPLAN → EXECUTION → RALPH → QA
- Add `src/pipeline/constraint-injector.ts` to filter constraints by profile and produce an enriched task prompt prepended to every downstream stage
- Add `src/pipeline/omc-bridge.ts` as the thin interface layer to OMC capabilities (ralplan, executor, ralph) — Reins orchestrates, OMC executes
- Add `src/pipeline/qa.ts` to run `pre_commit` and `post_develop` command lists from `constraints.yaml` pipeline config, capturing output and reporting pass/fail
- Write execution logs to `.reins/logs/executions/<timestamp>.yaml` after each pipeline run, recording stage durations, constraint violations, and QA results
- Profile-based stage skipping: `relaxed` profile omits RALPLAN, RALPH, and QA; `default` runs all stages; `strict` runs all stages with opus model

## Capabilities

### New Capabilities

- `pipeline-runner`: Orchestrates the full HARNESS_INIT → RALPLAN → EXECUTION → RALPH → QA sequence, threading the injected constraint context through every stage
- `constraint-injector`: Filters `constraints.yaml` by the active profile (all / critical+important / critical-only) and renders a structured preamble that is prepended to every prompt sent to OMC agents
- `omc-bridge`: Typed interface (`OMCBridge`) with three methods — `ralplan()`, `executor()`, `ralph()` — decoupling the pipeline from OMC's internal calling convention
- `qa-runner`: Executes the `pipeline.pre_commit` and `pipeline.post_develop` command arrays from config, stops on first failure, and returns a structured `QAResult`
- `execution-logger`: Records a `.reins/logs/executions/<id>.yaml` file after every pipeline run with stage timing, files changed, constraints checked/violated, and QA outcomes

### Modified Capabilities

- `reins-develop` (CLI command stub): Wired to invoke `pipeline/runner.ts`; previously threw "not yet implemented"

## Impact

- Depends on `p2-hook-system` being applied first — hooks must be registered before EXECUTION begins so the agent's tool calls are intercepted
- Depends on `mvp-constraint-engine` for a valid `constraints.yaml`
- The `omc-bridge` interface is a thin stub in Phase 2; actual OMC integration depth increases in Phase 3 (planning) and Phase 4 (review loop with evaluation exit conditions)
- Creates `.reins/logs/executions/` directory on first run
- `src/pipeline/qa.ts` calls `child_process.exec`; commands run in `projectRoot` CWD
