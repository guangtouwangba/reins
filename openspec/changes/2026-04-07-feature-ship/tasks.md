## 0. Spike: verify headless Claude Code + planning is usable

**This phase runs before committing to the rest of the work. If it fails, re-scope before proceeding.**

- [ ] **Task 0.1: Smoke-test `claude -p` for feature implementation**
  - Description: Manually run `claude -p "<a trivial implement-this-feature prompt>"` in a temp directory containing a minimal Node project (package.json + one source file). Observe: does it run non-interactively? Does it complete without prompting the user? Does it actually write files? Does it print token usage on exit? Record findings in `.reins/spike-findings.md` (temporary, not committed).
  - Files: none (manual spike)
  - Tests: none — this is exploratory
  - Done when: You have a yes/no answer to "does `claude -p` reliably complete a small feature end-to-end without user interaction." If no, stop and revise the proposal.

- [ ] **Task 0.2: Confirm output format assumptions**
  - Description: Run `claude -p "…"` on 3 different-size prompts and grep the stdout tail for anything resembling token counts. Document whatever format you see. If the format is unstable, `parseTokenUsage` falls back to `undefined` — which is fine, but document it.
  - Files: none
  - Done when: `parseTokenUsage` has a real regex derived from observed output, or an explicit decision to skip token tracking in v1.

- [ ] **Task 0.3: Smoke-test the planner prompt on a 5-feature fixture**
  - Description: Hand-write 5 realistic feature files covering a mix of clearly-parallelizable and clearly-serial work (e.g. "add login API" + "add signup API" + "add dark mode toggle" + "rename main package" + "update README"). Manually construct the planning prompt from design.md §11 and pass it to `claude -p`. Parse the JSON output. Check: (a) is it valid JSON at all, (b) does it respect a reasonable parallel/serial split, (c) does it cover all 5 feature ids exactly once, (d) does it fit the schema. Run this 5 times to gauge consistency. Record pass rate in `.reins/spike-findings.md`.
  - Files: none (manual spike)
  - Done when: You have a measured JSON-validity rate ≥ 80% across 5 runs, and the splits are at least as good as a naive topological sort. If not, the planner step is demoted to `planner_enabled: false` default and this proposal's v1 scope shrinks back to pure serial.

- [ ] **Task 0.4: Smoke-test git worktree + cherry-pick flow**
  - Description: In a throwaway repo, create 2 worktrees with `git worktree add`, make a different commit in each, then from the main checkout try `git cherry-pick <sha>` for each. Observe behavior on a clean case (both apply cleanly) and a conflict case (both modify the same line). Confirm `git cherry-pick --abort` leaves the main branch clean.
  - Files: none (manual spike)
  - Done when: You understand the exact exit codes and stderr output of cherry-pick in both cases. `rebaseAndMerge`'s conflict-detection regex can be derived from the observed output.

## 1. Feature file format + parser + storage

- [ ] **Task 1.1: Define feature types**
  - Description: Create `src/features/types.ts` with `Feature` interface (id, title, status, priority, depends_on, max_attempts, scope, created_at, updated_at, last_run_id, last_failure, body), `FeatureStatus` union type (`'draft' | 'todo' | 'in-progress' | 'implemented' | 'verified' | 'done' | 'blocked'`), and `FailureContext` interface (stage, command, exit_code, output, trace_tail).
  - Files: `src/features/types.ts`
  - Tests: `pnpm typecheck` passes; types importable.
  - Done when: All types defined and exported

- [ ] **Task 1.2: Implement feature file parser**
  - Description: Create `src/features/parser.ts` exporting `parseFeatureFile(path): Feature | null`. Use js-yaml to parse the frontmatter block delimited by `---` lines. Validate required fields and status enum. Extract the markdown body (everything after the second `---`). Return `null` with `console.warn` on invalid files. Tolerate extra unknown frontmatter fields (future-proofing).
  - Files: `src/features/parser.ts`
  - Tests: Unit test with a valid file → assert all fields parsed. Unit test with missing `status` field → assert returns null + warning. Unit test with invalid status enum value → assert null. Unit test with extra unknown fields → assert parsed and unknown fields ignored. Unit test with empty body → assert body is empty string. Unit test with file missing frontmatter delimiters → assert null.
  - Done when: Parser handles all cases in the feature-file spec (§1 of design.md) and the tests pass.

- [ ] **Task 1.3: Implement feature file storage**
  - Description: Create `src/features/storage.ts` exporting `writeFeature(path, feature)` (full write — used by `reins feature new`) and `updateFeatureFrontmatter(path, patch)` (frontmatter-only update — used by ship runner to flip status). The update function must preserve the body bytes verbatim and bump `updated_at` automatically. Use a regex to extract the frontmatter block, merge the YAML, and rewrite only that section.
  - Files: `src/features/storage.ts`
  - Tests: Unit test `writeFeature` round-trips through parser. Unit test `updateFeatureFrontmatter` changes status but leaves body intact (byte-compare before/after). Unit test concurrent updates do not corrupt file (write is synchronous). Unit test error on missing file.
  - Done when: Storage round-trips through the parser and preserves the body.

- [ ] **Task 1.4: Implement feature queue API**
  - Description: Create `src/features/index.ts` exporting `loadAllFeatures(projectRoot): Feature[]` (reads all `.md` files under `.reins/features/`, calls parser, filters out nulls), `pickNextFeature(features): Feature | null` (applies dependency resolution), and `hasCycle(features): boolean` (DFS-based cycle detection).
  - Files: `src/features/index.ts`, `src/features/resolver.ts`
  - Tests: Unit test `loadAllFeatures` with a dir containing 2 valid + 1 invalid file → assert returns 2. Unit test `pickNextFeature` with 3 todo features, one blocked by unfinished dep → assert the unblocked one with lowest priority is returned. Unit test `hasCycle` with A→B→A cycle → assert true. Unit test cycle with 3 nodes → assert true. Unit test no cycle → assert false.
  - Done when: Queue loading and resolution work; cycle detection catches both direct and transitive cycles.

## 2. `reins feature` CLI subcommands

- [ ] **Task 2.1: Implement `feature-cmd.ts`**
  - Description: Create `src/commands/feature-cmd.ts` exporting `runFeature(action, args)`. Handle actions: `list`, `show <id>`, `new <id>`, `status <id> [--json]`, `set-status <id> <new>`, `next`. Use the feature queue API. For `new`, accept a `--title` flag and fail if the file already exists unless `--force`. For `set-status`, validate the new status against the enum.
  - Files: `src/commands/feature-cmd.ts`
  - Tests: Unit test `runFeature('list', [])` on a dir with 2 features → assert output lists both. Unit test `runFeature('new', ['001-test'])` → assert file created with draft status. Unit test `runFeature('set-status', ['001-test', 'todo'])` → assert file status updated. Unit test `runFeature('next', [])` → assert prints the next feature id or empty. Unit test `runFeature('status', ['missing-id'])` → assert error message, exit code 1.
  - Done when: All actions work as specified.

- [ ] **Task 2.2: Register `feature` command in CLI**
  - Description: Add `reins feature <action> [args...]` to `src/cli.ts`. Route to `runFeature` via dynamic import (match existing style). Include a brief `--help` block listing the actions.
  - Files: `src/cli.ts`
  - Tests: `pnpm build` passes. Manual test: `node dist/cli.js feature list` in a temp project works.
  - Done when: CLI routes `reins feature` correctly.

## 3. Claude Code spawn wrapper

- [ ] **Task 3.1: Implement `spawnClaudeHeadless`**
  - Description: Create `src/ship/claude-spawn.ts` per design.md §4. Use `node:child_process.spawn` with `['-p', prompt]`. Handle timeout via `setTimeout` + `SIGTERM` → `SIGKILL` escalation. Handle `AbortSignal` for Ctrl+C cancellation. Capture stdout/stderr. Write attempt log to `opts.logDir/claude-<timestamp>.log`. Parse token usage defensively (no throws).
  - Files: `src/ship/claude-spawn.ts`
  - Tests: Unit test that a short `claude -p` invocation returns a result with exit code + stdout. **Skip the test if `claude` is not on PATH** (use `describe.skipIf`). Unit test timeout behavior with `/bin/sleep` as a stand-in (override the binary via env var for testability). Unit test that AbortSignal kills the child. Unit test that logs are written to `logDir`. Unit test that `parseTokenUsage` returns undefined on unparseable output without throwing.
  - Done when: Wrapper is robust to process failures, timeouts, cancellations, and malformed token output.

- [ ] **Task 3.2: Define run log layout**
  - Description: Create `src/ship/run-log.ts` exporting `createRunDir(projectRoot): string` (returns the new `.reins/runs/<iso>/` path), `writeRunSummary(runDir, summary)`, `writeAttemptLog(runDir, featureId, attemptNum, artifacts)` where artifacts is a map of filename → content. Also export `RunSummary` type matching design.md §9.
  - Files: `src/ship/run-log.ts`, `src/ship/types.ts`
  - Tests: Unit test `createRunDir` creates the dir and returns the path. Unit test `writeAttemptLog` creates nested structure `<feature>/attempt-N/`. Unit test `writeRunSummary` serializes to valid JSON.
  - Done when: Log infra is in place and tests verify the layout.

## 4. Verify layer

- [ ] **Task 4.1: Extend `PipelineConfig` schema**
  - Description: Add `feature_verify?: string[]` and `browser_verify?: BrowserVerifyConfig` to `PipelineConfig` in `src/constraints/schema.ts`. Define `BrowserVerifyConfig` and `DevServerConfig` interfaces. Both new fields are optional. No migration needed — existing files continue to parse (extras silently ignored was already the case; new fields default undefined).
  - Files: `src/constraints/schema.ts`, `src/constraints/index.ts`
  - Tests: Unit test that loading a `constraints.yaml` without the new fields returns config with `feature_verify === undefined`. Unit test that loading with the new fields parses them correctly. `pnpm typecheck` passes.
  - Done when: Schema extended without breaking existing tests.

- [ ] **Task 4.2: Implement `runPreCommit` and `runFeatureVerify`**
  - Description: Create `src/ship/verify.ts` exporting both. Each reads the corresponding pipeline array from `constraints.yaml` and runs commands sequentially via `execSync` (same contract as `gate/stop.ts` uses). Short-circuit on first failure. Return `VerifyResult { passed: boolean, skipped?: boolean, failure?: { command, exit_code, output } }`. Timeout per command is 60s for `pre_commit`, 600s for `feature_verify`. Capture combined stdout+stderr, truncate to last 4000 chars per command.
  - Files: `src/ship/verify.ts`
  - Tests: Unit test with `pipeline.pre_commit: ['true']` → assert passed. Unit test with `['false']` → assert failed with exit_code 1. Unit test with multiple commands where the second fails → assert stops at second, reports it. Unit test with empty array → assert skipped=true.
  - Done when: Both functions handle pass, fail, timeout, and empty cases.

- [ ] **Task 4.3: Implement scope drift check**
  - Description: Create `src/ship/drift-check.ts` per design.md §8. Use `minimatch` (already in deps) to match globs against `git status --porcelain` output. Return `{ touchedFiles, outOfScope }`. Do not throw on git errors — return empty arrays.
  - Files: `src/ship/drift-check.ts`
  - Tests: Unit test with scope `['src/**']` and git output showing `src/a.ts` + `docs/b.md` → assert `outOfScope = ['docs/b.md']`. Unit test with undefined scope → assert both arrays empty. Unit test with no touched files → assert both empty. Unit test with git command failure (fake cwd) → assert returns empty arrays, no throw.
  - Done when: Drift check works with realistic glob patterns and fails gracefully.

## 5. Prompt builder

- [ ] **Task 5.1: Implement `buildImplementPrompt`**
  - Description: Create `src/ship/prompt-builder.ts` per design.md §7. Load important+critical constraints from `constraints.yaml` (skip helpful). Include the feature body verbatim. If `previousFailure` is provided, append a "Previous attempt failed" section with stage, command, exit code, and tail-100 output. Always end with the "append to Notes section" instruction. Export `tail(text, n)` helper.
  - Files: `src/ship/prompt-builder.ts`
  - Tests: Unit test with a feature + no previous failure → assert output contains title, body, constraints section. Unit test with a previous failure → assert includes stage, command, tail of output. Unit test tail > input length → assert returns full input. Unit test that "do not weaken the tests" string is present on retry prompts.
  - Done when: Prompt is stable, deterministic, and includes all required sections.

## 6. Ship runner

- [ ] **Task 6.1: Implement execution planner**
  - Description: Create `src/ship/planner.ts` per design.md §11. Export `planExecution(projectRoot, features, maxParallelism, runDir): Promise<ExecutionPlan>`. Three code paths: (a) `planner_enabled=false` or features.length ≤ 1 → fallback plan from `depends_on` topological sort; (b) build planning prompt via `prompt-builder.ts buildPlanningPrompt`, call `spawnClaudeHeadless` with 120s timeout and output parsed as JSON; (c) post-validate (all ids present exactly once, depends_on respected, scope overlap within parallel steps triggers a split). Write raw response to `<runDir>/planner-raw.log` regardless of outcome. Write final plan to `<runDir>/plan.json`.
  - Files: `src/ship/planner.ts`, `src/ship/prompt-builder.ts` (add `buildPlanningPrompt`)
  - Tests: Unit test fallback path with 3 features and depends_on chain → assert returns 3 serial steps in correct order. Unit test AI path with a mock `spawnClaudeHeadless` returning valid JSON → assert the plan is returned as-is with `source: 'ai'`. Unit test AI path with invalid JSON → assert fallback plan returned with warning. Unit test post-validation: scope overlap in a parallel step → assert step is split. Unit test post-validation: missing feature id → assert fallback.
  - Done when: Planner handles AI success, AI failure, post-validation split, and fallback cases; all tests pass.

- [ ] **Task 6.2: Implement worktree helper**
  - Description: Create `src/ship/worktree.ts` per design.md §12. Export `createWorktree(projectRoot, featureId, baseBranch?)` (runs `git worktree add -b reins/feature-<id> .reins/wt/<id> HEAD`), `rebaseAndMerge(projectRoot, handle)` (fetches from worktree and cherry-picks its tip commit onto the current main; on conflict runs `git cherry-pick --abort` and returns the conflict output), and `removeWorktree(handle, force)` (runs `git worktree remove`). Capture git stderr for all operations; on any command failure return structured error, never throw from top-level.
  - Files: `src/ship/worktree.ts`
  - Tests: Integration test using a real git repo fixture in a temp dir. Test 1: create worktree, commit in it, cherry-pick back — assert success and commit sha on main. Test 2: create 2 worktrees that both modify the same line, cherry-pick first one (succeeds), cherry-pick second one (conflict) — assert returned conflict message contains the conflicting file. Test 3: `removeWorktree` after successful merge — assert directory gone. These are integration tests because mocking git is more fragile than using a real temp repo.
  - Done when: Worktree operations work on a real fixture; conflict detection returns structured info.

- [ ] **Task 6.3: Implement `pLimit` concurrency helper**
  - Description: Create `src/ship/concurrency.ts` exporting `pLimit<T>(limit: number, tasks: Array<() => Promise<T>>): Promise<T[]>` — a minimal promise-pool that runs up to `limit` tasks concurrently, returning results in input order. No external dependency — 15 lines of code.
  - Files: `src/ship/concurrency.ts`
  - Tests: Unit test with 5 tasks and limit=2 — assert only 2 run concurrently (use a shared counter with peak tracking). Unit test with limit=1 — assert pure sequential. Unit test with limit > tasks.length — assert all run in parallel. Unit test with a task that throws — assert the promise pool rejects with that error and unfinished tasks are not awaited (or are awaited then discarded; document the choice).
  - Done when: `pLimit` is correct and covered by tests.

- [ ] **Task 6.4: Implement commit helper with convention detection**
  - Description: Create `src/ship/commit.ts` per design.md §13. Export `detectCommitStyle(projectRoot, override): Promise<CommitStyle>` (reads `git log --oneline -20`, matches against conventional pattern, returns `'conventional'` if ≥ 80% match else `'free'`; respects override if not `'auto'`). Export `buildCommitMessage(feature, runId, attempts, style, template?): string`. Export `commitFeature(cwd, feature, runId, attempts, style, template?): Promise<CommitResult>` that runs `git add -A` then `git commit -m <msg>`, captures stderr/stdout on failure, returns `{ success, sha }` or `{ success: false, hookOutput }`.
  - Files: `src/ship/commit.ts`
  - Tests: Unit test `detectCommitStyle` with fixture git log containing 16/20 conventional commits → assert returns `'conventional'`. Unit test with 10/20 → assert `'free'`. Unit test with override `'conventional'` → assert returns without reading log. Unit test `buildCommitMessage` with conventional style → assert format `feat: <title>\n\nReins-feature-id: ...`. Unit test `commitFeature` in a real git fixture with a passing state → assert sha returned. Unit test with a pre-commit hook that exits 1 → assert `success: false` with hookOutput set.
  - Done when: Commit helper works end-to-end on a real git fixture, including pre-commit hook failure.

- [ ] **Task 6.5: Implement per-feature state machine**
  - Description: Create/extend `src/ship/runner.ts` exporting `runFeature(feature, cwd, runDir, ctx): Promise<FeatureRunResult>`. Implement the loop from design.md §6 "Per-feature": set in-progress, loop up to `max_attempts`, call `spawnClaudeHeadless` with `cwd` (which is either the main repo path or a worktree path), check drift (warn in serial / block in parallel based on `ctx.isParallel`), run pre_commit, run feature_verify, **call `commitFeature` if `ctx.config.ship.auto_commit`** (treat failures as verify failures for retry purposes), transition to done or blocked. Write attempt logs via `writeAttemptLog`. Update feature status via `updateFeatureFrontmatter`. Do NOT update status to `done` until after the commit succeeds when auto_commit is on.
  - Files: `src/ship/runner.ts`
  - Tests: Unit test with mock claude-spawn succeeds + mock verify passes + mock commit succeeds → assert status=done after 1 attempt, commit sha recorded. Unit test mock verify fails twice then passes → assert 3 attempts, status=done. Unit test mock commit fails (pre-commit hook rejected) → assert counted as attempt, retry happens with hookOutput in next prompt. Unit test `ctx.isParallel=true` + drift detected → assert block, not warn. Unit test `ctx.config.ship.auto_commit=false` → assert no commit call, status=done after verify passes.
  - Done when: Per-feature state machine handles all transitions including commit and parallel-mode drift.

- [ ] **Task 6.6: Implement `runShip` orchestrator with step-aware dispatch**
  - Description: Create `src/ship/index.ts` exporting `runShip(projectRoot, opts): Promise<RunSummary>`. Load all features, create run dir, acquire `.reins/runs/.lock`, install SIGINT handler, detect commit style once and pass into ctx, call `planExecution` to get plan, write `plan.json`, loop through `plan.steps`: for serial steps run `runFeature` directly in `projectRoot`; for parallel steps call `runParallelStep` which creates worktrees, runs features in parallel via `pLimit`, rebases successful ones back. **Pause the ship if a step has any blocked feature** (do not proceed to next step because it may depend). Support `opts.only`, `opts.dryRun`, `opts.maxAttempts`, `opts.maxParallelism`, `opts.noCommit`.
  - Files: `src/ship/index.ts`
  - Tests: Unit test with 3 features in a single serial step where all pass → assert 3 done, run.json correct. Unit test with a parallel step of 2 features, both pass, mock rebase succeeds → assert both done. Unit test with a parallel step where 1 fails, 1 passes → assert failing one blocked, succeeding one done, **next step is NOT attempted** (ship paused). Unit test dryRun=true → assert planExecution runs but no features spawn. Unit test concurrent ship (manual lock file) → assert second invocation exits cleanly.
  - Done when: Orchestrator handles serial + parallel steps, step-level pause on block, and produces a valid RunSummary.

- [ ] **Task 6.7: Implement `ship-cmd.ts` CLI entry**
  - Description: Create `src/commands/ship-cmd.ts` exporting `runShipCommand(options)`. Parse CLI flags (`--only`, `--dry-run`, `--max-attempts`, `--parallel N` (clamps `ctx.maxParallelism`; pass 1 to force all-serial which also skips planner), `--no-commit`). Call `runShip`. On completion, print a structured summary including: the executed plan steps with timings, per-feature status with commit shas, paths to preserved worktrees (if any blocked), cumulative token usage.
  - Files: `src/commands/ship-cmd.ts`
  - Tests: Unit test with all passing features → exit 0 and "all done" message. Unit test with blocked feature → exit 1 and lists blocked features with failure reasons and worktree paths. Unit test `--parallel 1` → assert maxParallelism=1 and planner_enabled overridden to false.
  - Done when: CLI entry prints useful summaries and exits with correct codes.

- [ ] **Task 6.8: Register `ship` command in CLI**
  - Description: Add `reins ship` to `src/cli.ts` with flags listed above. Route to `runShipCommand` via dynamic import.
  - Files: `src/cli.ts`
  - Tests: `pnpm build` passes. Manual test: `node dist/cli.js ship --dry-run` on a test project prints the planned DAG without spawning anything.
  - Done when: `reins ship` is callable from CLI.

## 7. Ship config section

- [ ] **Task 7.1: Add `ShipConfig` to `ReinsConfig`**
  - Description: Add `ShipConfig` interface and `ship?: ShipConfig` field to `ReinsConfig` in `src/state/config.ts` per design.md §10. Default values: `default_max_attempts: 3`, `implement_timeout_ms: 600000`, `feature_verify_timeout_ms: 600000`, `log_retention_days: 30`, `abort_on_scope_drift: false`. Add defaults to `getDefaultConfig()`.
  - Files: `src/state/config.ts`
  - Tests: Unit test `getDefaultConfig().ship?.default_max_attempts === 3`. Unit test that loading a config yaml without `ship:` returns defaults. Unit test that loading with a custom `ship.default_max_attempts: 5` returns 5.
  - Done when: Config section is wired up with defaults.

## 8. init and status integration

- [ ] **Task 8.1: Update init to create `features/` dir**
  - Description: In `src/commands/init.ts`, after creating `.reins/`, also create `.reins/features/` (empty). Add a line to the "Generated files" summary: `✓ .reins/features/ (feature queue — empty, run /reins-feature-new to add one)`.
  - Files: `src/commands/init.ts`
  - Tests: Update `src/commands/init.test.ts` to assert the directory is created after init runs.
  - Done when: Fresh init creates the dir and init test passes.

- [ ] **Task 8.2: Update `reins status` to show feature queue**
  - Description: In `src/commands/status.ts`, after the constraints summary, read `.reins/features/` and append a queue section showing: count by status (`todo: 3, in-progress: 0, done: 5, blocked: 1`), and list of blocked features with their `last_failure.stage`. If no features exist, print "No features in queue — add one with /reins-feature-new".
  - Files: `src/commands/status.ts`
  - Tests: Update `status.test.ts` fixture to include a `features/` dir with 3 feature files, assert output includes the queue section.
  - Done when: Status output includes feature queue summary.

## 9. Slash commands

- [ ] **Task 9.1: Create `/reins-feature-new` workflow**
  - Description: Create `src/workflows/feature-new.ts` exporting a `Workflow` object. The body instructs the IDE-LLM to: (1) Use AskUserQuestion for title, short description, acceptance checklist (free-form), optional scope globs. (2) Derive a kebab-case id. (3) Call `reins feature new <id> --title "<title>"` via Bash. (4) Open the file and append the acceptance checklist and any "Browser test" prose. (5) Leave status as draft so user can verify before running ship.
  - Files: `src/workflows/feature-new.ts`
  - Tests: Extend `src/workflows/` — not much to unit test directly; verify it's registered in `getWorkflows()`.
  - Done when: Workflow file exists and is exported.

- [ ] **Task 9.2: Create `/reins-ship-here` workflow**
  - Description: Create `src/workflows/ship-here.ts`. The body instructs the IDE-LLM to: (1) Take a feature id argument or ask for one. (2) Read the feature file. (3) Do the implementation work **in the current IDE session** (foreground, no headless spawn). (4) Run `reins gate stop`-equivalent verification (pre_commit + feature_verify by calling them directly). (5) Report back to the user. This is for debugging features that get stuck in the headless `reins ship` run — the user wants to see what Claude Code is thinking step by step.
  - Files: `src/workflows/ship-here.ts`
  - Done when: Workflow file exists and is exported.

- [ ] **Task 9.3: Register new workflows in `getWorkflows()`**
  - Description: Import and add `featureNewWorkflow` and `shipHereWorkflow` to the array returned by `getWorkflows()` in `src/workflows/index.ts`. The claude-md adapter auto-picks them up since it loops the registry.
  - Files: `src/workflows/index.ts`
  - Tests: Update `src/commands/init.test.ts` assertions to expect 7 slash command files in `.claude/commands/reins/` instead of 5.
  - Done when: Init test passes with the new slash command files listed.

## 10. Integration test

- [ ] **Task 10.1: End-to-end ship integration test**
  - Description: Create `src/ship/ship.test.ts`. Set up a temp project with: a trivial package.json, `.reins/constraints.yaml` with `pipeline.pre_commit: ['true']` and `pipeline.feature_verify: ['echo ok']`, `.reins/features/001-trivial.md` with status `todo`. **Mock `spawnClaudeHeadless`** to simulate Claude Code by: (a) touching a marker file, (b) exiting 0. Run `runShip` on the project. Assert: feature status flipped to `done`, `.reins/runs/<id>/run.json` exists and shows 1 feature done, marker file exists, attempt log captures stdout.
  - Files: `src/ship/ship.test.ts`
  - Tests: As above plus: test with failing verify → assert retry then blocked. Test with mock that exits nonzero → assert retry.
  - Done when: Integration test covers the happy path and one failure path without needing a real `claude` binary.

## 11. Documentation + verification

- [ ] **Task 11.1: Update README / AGENTS.md references**
  - Description: If there's a top-level README mentioning CLI commands, add `reins feature` and `reins ship` sections with a one-paragraph "what / why / when" each. Do NOT rewrite the README — just append two sections.
  - Files: `README.md` (append-only; create if missing and only if missing)
  - Done when: README mentions the new commands.

- [ ] **Task 11.2: Full verification**
  - Description: Run `pnpm lint`, `pnpm build`, `pnpm test`. Then manually: `node dist/cli.js init --no-input` in a temp dir → assert features/ dir exists, 7 slash commands in `.claude/commands/reins/`. `node dist/cli.js feature new 001-test` → assert file created. `node dist/cli.js feature list` → assert shows the new feature. `node dist/cli.js ship --dry-run` → assert prints plan without spawning claude.
  - Files: none (verification only)
  - Tests: All 362+ tests pass, plus the ~30 new tests from this change.
  - Done when: Clean lint/build/test and manual smoke test matches expectations.

## Out of scope for this change (explicitly deferred)

These are called out so reviewers understand what's deliberately missing:

- **v2 browser_verify runner**: schema is added in §4.1, but the runner that reads it (with Playwright spec auto-generation and AI-driven dev server discovery) is a follow-up change.
- **v2 Playwright spec generation via a second `claude -p` call**: follow-up.
- **v2 dev server lifecycle management + AI discovery**: follow-up.
- **Multi-provider abstraction** (codex, opencode, cursor): v1 is hardcoded to `claude` on PATH.
- **Telemetry / remote run aggregation**: explicit non-goal.
- **Auto-push, auto-PR, auto-merge to a release branch**: explicit non-goal. Ship commits to the current branch (or rebases worktrees to it); user decides what to push.
- **`reins ship --show-last` pretty-printer**: nice-to-have, not in v1.
- **Visual AI judge for screenshots**: explicit non-goal.
- **Hook-block awareness in retry strategy**: v1 treats project-side pre-commit hook rejections the same as test failures (retry with hook output in next prompt). v2 could special-case them.
- **Automatic merge conflict resolution**: v1 aborts on rebase conflict and preserves the worktree; the user resolves manually.
- **Sub-feature task decomposition**: v1 treats each feature as an atomic implement-then-verify unit. If a feature is too big, user splits it into multiple feature files manually.
