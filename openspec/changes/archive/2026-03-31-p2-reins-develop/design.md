## Approach

Wire the existing `develop` command stub in `src/cli.ts` to the `runPipeline()` function from `p2-pipeline-runner`. The command handler loads config, invokes the pipeline, prints per-stage progress to stdout as stages complete, and exits with the appropriate code. No new abstractions are needed — this change is primarily plumbing between the CLI layer and the pipeline module.

## Architecture

**CLI command** (`src/cli.ts` — modified):
- The existing `develop` command stub is replaced with a full handler
- Commander.js registration:
  ```
  program
    .command('develop <task>')
    .option('--profile <profile>', 'constraint profile', 'default')
    .option('--skip <stages...>', 'stages to skip (qa, planning)')
    .action(developHandler)
  ```
- `developHandler(task, opts)`:
  1. Resolves `projectRoot` from `process.cwd()`
  2. Calls `loadConfig(projectRoot)` — exits with error if `.reins/` does not exist (reins not initialized)
  3. Constructs `PipelineOpts` from CLI options; `--skip` values map to `skipStages` array
  4. Sets up a stage progress printer (see below)
  5. Calls `runPipeline(task, projectRoot, opts)`
  6. Prints final summary line
  7. Calls `process.exit(result.success ? 0 : 1)`

**Progress display**:
- The pipeline runner accepts an optional `onStageChange(stage, event)` callback in `PipelineOpts`
- `event` is `'start' | 'complete' | 'skip'`
- The CLI handler implements this callback to print stage headers:
  - On `start`: `  ── <STAGE> ` + trailing dashes to 50 chars
  - On `complete` (success): `  ✓ <stage> (<duration>s)`
  - On `complete` (failure): `  ✗ <stage> — <error reason>`
  - On `skip`: `  ○ <stage> (skipped)`
- All progress output goes to stdout; errors go to stderr

**Error handling**:
- "reins not initialized": check for `.reins/constraints.yaml`; if missing, print actionable message (`run 'reins init' first`) and exit 1
- Pipeline stage failure: the runner returns `success: false` with a `failedStage` and `error` field; the handler prints the error and exits 1
- Unexpected exceptions: caught at the top level of `developHandler`, printed to stderr, exit 1

**Log path display**:
- After a run (success or failure), print the path to the execution log file so users can inspect it:
  `  Log: .reins/logs/executions/<id>.yaml`

## Key Decisions

- **`onStageChange` callback in PipelineOpts rather than events/emitter**: A simple callback is the smallest interface that lets the CLI display progress without the pipeline module depending on any UI layer. The pipeline runner calls it synchronously before and after each stage.
- **`process.exit()` not `throw`**: Commander.js wraps `.action()` handlers; throwing an error produces a Commander error message with usage text, which is not the right UX for a runtime failure. Explicit `process.exit(1)` after printing a clear message gives the user exactly what they need.
- **No interactive confirmation prompt in Phase 2**: The module design shows a planning confirmation step ("继续？[y/n/edit plan]"), but RALPLAN is a stub in Phase 2. The confirmation prompt will be added in Phase 3 when `ralplan()` produces a real plan to review.
- **`--skip` accepts multiple values**: `--skip qa planning` should work. Commander's `<stages...>` variadic option handles this; the handler splits and normalizes to lowercase before passing to the pipeline.

## File Structure

```
src/
└── cli.ts                    # modified: develop command stub → full handler with progress display
```

No new files. All pipeline and evaluation logic lives in modules introduced by the sibling Phase 2 changes. This change is purely the CLI wiring layer.
