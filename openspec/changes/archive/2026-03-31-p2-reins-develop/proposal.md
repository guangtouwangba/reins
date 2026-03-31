## Why

The `reins develop` command exists as a CLI stub but does nothing — it throws "not yet implemented". Phase 2 has built the pipeline runner, hook system, and L0 evaluation as independent modules; this change wires them together into a working end-to-end `reins develop <task>` command that users can actually run.

## What Changes

- Implement the `reins develop <task>` Commander.js command in `src/cli.ts`, accepting `--profile` (default: `default`) and `--skip` (values: `qa`, `planning`) options
- Connect the command handler to `src/pipeline/runner.ts` to execute the full pipeline
- Add interactive progress display: print stage headers as each pipeline stage starts and a result line (pass/fail + duration) when it completes
- Wire `src/evaluation/evaluator.ts` into the pipeline's QA stage via `src/pipeline/qa.ts`
- Write execution results to `.reins/logs/` after each run, using the execution logger from `p2-pipeline-runner`
- Handle errors gracefully: if a stage fails, print the failure reason and exit with code 1; do not throw unhandled exceptions to the user

## Capabilities

### New Capabilities

- `develop-command`: `reins develop <task> [--profile default|strict|relaxed] [--skip qa|planning]` runs the full constraint-aware development pipeline and shows per-stage progress in the terminal

### Modified Capabilities

- `cli-entry`: `src/cli.ts` previously registered `develop` as a stub; now wired to the pipeline runner with full option parsing

## Impact

- Depends on all three sibling Phase 2 changes: `p2-hook-system` (hooks must be generated before pipeline runs), `p2-pipeline-runner` (pipeline orchestration), `p2-evaluation-l0` (L0 exit condition)
- Requires a valid `.reins/constraints.yaml` in the project root (produced by `reins init`)
- Progress output writes to stdout; errors write to stderr
- Execution logs land in `.reins/logs/executions/` (created by pipeline runner on first use)
- `--skip qa` maps to `config.develop.skip_stages: ["qa"]` for this run only; does not mutate `config.yaml`
