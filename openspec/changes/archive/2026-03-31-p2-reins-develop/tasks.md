## Tasks

- [ ] **Task 1: Implement guard check for uninitialized project**
  - Description: Write a helper `assertReinsInitialized(projectRoot: string): void` that checks for the existence of `.reins/constraints.yaml`. If the file does not exist, print `Error: reins is not initialized in this project. Run 'reins init' first.` to stderr and call `process.exit(1)`. This guard runs at the start of the develop command handler before any pipeline work begins.
  - Files: `src/commands/develop.ts` (new file for the command handler) or inline in `src/cli.ts`
  - Tests: Unit test that `assertReinsInitialized` exits with code 1 when the file is absent; use a temp directory without the file; verify stderr message
  - Done when: Guard exits 1 with the correct message when `.reins/constraints.yaml` is absent; no false positives when the file exists

- [ ] **Task 2: Register `develop` command in `src/cli.ts`**
  - Description: Replace the existing `develop` stub in `src/cli.ts` with a full Commander.js command registration: `.command('develop <task>')`, `.option('--profile <profile>', 'constraint profile (strict|default|relaxed)', 'default')`, `.option('--skip <stages...>', 'skip stages: qa, planning')`, `.action(developHandler)`. Import `developHandler` from `src/commands/develop.ts`. Remove the "not yet implemented" throw.
  - Files: `src/cli.ts`
  - Tests: Run `node dist/cli.js develop --help` and verify the profile and skip options appear; verify the command name is `develop`
  - Done when: `reins develop --help` shows correct options; the stub throw is removed; the action is wired to the handler

- [ ] **Task 3: Implement `developHandler` with progress display**
  - Description: Write `developHandler(task: string, opts: DevelopOpts): Promise<void>`. Flow: (1) resolve `projectRoot`, (2) call `assertReinsInitialized`, (3) call `loadConfig`, (4) map CLI opts to `PipelineOpts` — `opts.skip` (array) maps to `skipStages`, `opts.profile` maps to `profile`, (5) build an `onStageChange` callback that prints stage progress lines, (6) call `runPipeline(task, projectRoot, pipelineOpts)`, (7) print the log path and final status line, (8) call `process.exit(result.success ? 0 : 1)`. Wrap the entire body in a try/catch that prints unexpected errors to stderr and exits 1.
  - Files: `src/commands/develop.ts`
  - Tests: Integration test with mocked `runPipeline` returning a success result — verify stdout contains at least one progress line and the log path; mock returning a failure result — verify exit code is 1 and failure stage is printed
  - Done when: Handler prints stage progress via `onStageChange`; log path is printed; exit code matches pipeline result; unexpected errors are caught and printed

- [ ] **Task 4: Implement progress printer**
  - Description: Implement the `onStageChange(stage, event)` callback inside `developHandler`. Stage name should be printed in uppercase. Format: start event prints `  ── <STAGE> ` padded with dashes to column 50; complete (success) prints `  ✓ <stage> (<N>s)`; complete (failure) prints `  ✗ <stage> — <error>`; skip prints `  ○ <stage> (skipped)`. Track stage start times using `Date.now()` to compute duration for the complete event. All output goes to `process.stdout.write`.
  - Files: `src/commands/develop.ts`
  - Tests: Unit test the progress formatter functions directly: verify start line is padded to 50 chars; verify complete line includes duration; verify skip line includes "(skipped)"
  - Done when: Progress lines are formatted correctly; durations are accurate; all three event types produce distinct formatted output

- [ ] **Task 5: End-to-end smoke test**
  - Description: Write an integration test that creates a minimal fixture project with `.reins/constraints.yaml` (empty constraint list), runs `developHandler('add hello world', { profile: 'relaxed', skip: [] })` with `runPipeline` mocked to return a successful result, and verifies: (a) no unhandled exceptions, (b) stdout contains stage progress lines, (c) stdout contains a log path, (d) `process.exit` would be called with 0. Also test the failure path: mock `runPipeline` returning `{ success: false, failedStage: 'qa', error: 'lint failed' }` and verify exit 1 and the error is printed.
  - Files: `src/commands/develop.test.ts`
  - Tests: The test itself — success path and failure path as described above
  - Done when: Both paths pass without errors; the integration test can be run with `pnpm test`
