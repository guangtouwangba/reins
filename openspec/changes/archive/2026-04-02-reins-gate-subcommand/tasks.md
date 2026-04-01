## 1. Gate shared utilities

- [ ] **Task 1.1: Create gate shared module**
  - Description: Create `src/gate/shared.ts` with shared utilities: `parseGateInput()` reads `CLAUDE_TOOL_INPUT` env var and parses JSON; `outputResult(result)` writes messages to stdout, blockReason to stderr, and exits with code 0 or 2; `loadConstraints(projectRoot)` loads and parses `.reins/constraints.yaml`; `isProtectedPath(filePath)` checks if path is under `.reins/` or matches protected patterns; `resolveProjectRoot()` walks up from cwd to find `.reins/` directory.
  - Files: `src/gate/shared.ts`
  - Tests: Unit test `parseGateInput` with valid JSON env var → assert parsed fields. Unit test with missing env var → assert empty object. Unit test with malformed JSON → assert empty object. Unit test `isProtectedPath` with `.reins/constraints.yaml` → assert true. Unit test with `src/index.ts` → assert false. Unit test `resolveProjectRoot` from a subdirectory → assert finds parent with `.reins/`.
  - Done when: All utilities exported; `pnpm typecheck` passes

- [ ] **Task 1.2: Define gate types**
  - Description: Create `src/gate/types.ts` with `GateInput` interface (tool_name, file_path, path, old_string, new_string, command, prompt, result), `GateResult` interface (action: 'allow' | 'warn' | 'block', messages: string[], blockReason?: string), and `GateEvent` type ('context' | 'pre-edit' | 'post-edit' | 'pre-bash' | 'stop').
  - Files: `src/gate/types.ts`
  - Tests: `pnpm typecheck` passes; types importable from other modules.
  - Done when: All types defined and exported

## 2. Gate handlers

- [ ] **Task 2.1: Implement gate context handler**
  - Description: Create `src/gate/context.ts`. Export `gateContext(projectRoot, input): Promise<GateResult>`. Load constraints and filter to critical + important severity. Call `retrieveKnowledge()` from `src/knowledge/retriever.ts` with `input.prompt` as taskDescription, maxResults 5. Call `formatInjection()` to format knowledge entries. If `skill-index.json` exists, load it and match skills by keyword overlap with the prompt (reuse scoring logic from `src/pipeline/skill-matcher.ts`). Assemble output as `[Reins Constraints]` section + knowledge injection + `[Reins Matched Skills]` section. Return as GateResult with action 'allow'.
  - Files: `src/gate/context.ts`
  - Tests: Unit test with 3 constraints (1 critical, 1 important, 1 helpful) → assert output contains only critical and important. Unit test with mock knowledge entries → assert formatted injection in output. Unit test with empty prompt → assert empty messages. Unit test with no knowledge dir → assert runs without error.
  - Done when: Context injection assembles constraints + knowledge + skills; output matches design format

- [ ] **Task 2.2: Implement gate pre-edit handler**
  - Description: Create `src/gate/pre-edit.ts`. Export `gatePreEdit(projectRoot, input): Promise<GateResult>`. First check `isProtectedPath(input.file_path)` → block if true. Then load constraints, filter to `hook_type === 'post_edit'` (same constraints apply pre and post). For each constraint with `hook_check` regex, test against `input.new_string`. If match and mode is 'block' → return block result. If mode is 'warn' → add to messages. Also check scope: if constraint has `directory:` scope, skip if file is not in that directory.
  - Files: `src/gate/pre-edit.ts`
  - Tests: Unit test editing `.reins/constraints.yaml` → assert blocked. Unit test with constraint `hook_check: 'try\\s*\\{' ` and new_string containing `try {` → assert blocked. Unit test with warn mode → assert warning message, not blocked. Unit test with directory-scoped constraint and file outside scope → assert not triggered. Unit test with no new_string → assert allow.
  - Done when: Protection check + constraint matching works; scope filtering correct

- [ ] **Task 2.3: Implement gate post-edit handler**
  - Description: Create `src/gate/post-edit.ts`. Export `gatePostEdit(projectRoot, input): Promise<GateResult>`. Read the actual file content from disk (the edit has already been applied). Load constraints with `hook_type === 'post_edit'`. For each constraint with `hook_check`, test regex against file content. Apply scope filtering. Return block or warn based on hook_mode.
  - Files: `src/gate/post-edit.ts`
  - Tests: Unit test with fixture file containing `try { } catch` and constraint checking for it → assert blocked. Unit test with clean file → assert allow. Unit test with nonexistent file → assert allow (file may have been deleted).
  - Done when: Post-edit reads file from disk and checks constraints; handles missing files gracefully

- [ ] **Task 2.4: Implement gate pre-bash handler**
  - Description: Create `src/gate/pre-bash.ts`. Export `gatePreBash(projectRoot, input): Promise<GateResult>`. Load constraints with `hook_type === 'pre_bash'`. For each constraint with `hook_check`, test regex against `input.command`. After constraint checks, call `retrieveKnowledge()` with the command as taskDescription, filter to `type === 'gotcha'`, maxResults 3. Append gotcha summaries as `reins [knowledge]` messages.
  - Files: `src/gate/pre-bash.ts`
  - Tests: Unit test with constraint blocking `rm -rf /` pattern and matching command → assert blocked. Unit test with safe command → assert allow. Unit test with gotcha knowledge about the command → assert knowledge message in output. Unit test with empty command → assert allow.
  - Done when: Command guard + knowledge retrieval works

- [ ] **Task 2.5: Implement gate stop handler**
  - Description: Create `src/gate/stop.ts`. Export `gateStop(projectRoot, input): Promise<GateResult>`. Step 1: run `runL0Static()` from evaluator — run lint + typecheck (skip test by default, configurable via `config.gate.stop_skip_test`). If L0 fails → return block with failure details. Step 2: run `runL1Coverage()` — check new files have tests. L1 failures are warnings, not blocks. Step 3: call `captureKnowledgeFromDiff(projectRoot)` to auto-extract knowledge from git diff. Format captured entries in output messages.
  - Files: `src/gate/stop.ts`
  - Tests: Unit test with failing lint → assert blocked with error message. Unit test with passing L0 → assert allow. Unit test with new file without test → assert L1 warning message. Integration test with mock git diff showing 2 modules changed → assert coupling knowledge captured.
  - Done when: L0 gate blocks on failure; L1 warns; knowledge auto-captured

- [ ] **Task 2.6: Implement knowledge capture from git diff**
  - Description: Add `captureKnowledgeFromDiff(projectRoot): Promise<CapturedKnowledge[]>` to `src/gate/stop.ts`. Run `git diff --cached --name-only` (fallback to `git diff --name-only`). Group changed files by top-level module (first 2 path segments). If 2+ modules changed together → create coupling entry (confidence 50). If dependency files changed (package.json, go.mod, Cargo.toml) → create decision entry (confidence 40). Save entries to knowledge store via `saveEntry()` from `src/knowledge/store.ts`.
  - Files: `src/gate/stop.ts`
  - Tests: Unit test with files from `src/auth/` and `src/middleware/` → assert coupling entry created. Unit test with `package.json` change → assert decision entry created. Unit test with single module change → assert no coupling entry. Unit test that entries are saved with correct confidence.
  - Done when: Git diff analysis produces knowledge entries; entries saved to store

## 3. Gate entry point and CLI

- [ ] **Task 3.1: Create gate index/router**
  - Description: Create `src/gate/index.ts`. Export `runGate(event: GateEvent): Promise<void>`. Parse input via `parseGateInput()`, resolve project root via `resolveProjectRoot()`, route to handler based on event string. Wrap in try/catch: on error, output warning (not block) and exit 0 — gate should never crash Claude Code.
  - Files: `src/gate/index.ts`
  - Tests: Unit test routing 'context' → assert gateContext called. Unit test routing 'pre-edit' → assert gatePreEdit called. Unit test with unknown event → assert exit 0 with warning. Unit test with handler throwing → assert exit 0 with error message (not crash).
  - Done when: Router dispatches correctly; errors handled gracefully

- [ ] **Task 3.2: Register gate CLI command**
  - Description: Add `reins gate <event>` command to `src/cli.ts`. The event argument is required, must be one of: context, pre-edit, post-edit, pre-bash, stop. Call `runGate(event)`. This command is not shown in `--help` overview (it's internal, called by hook scripts).
  - Files: `src/cli.ts`
  - Tests: `pnpm typecheck` passes. Manual test: `CLAUDE_TOOL_INPUT='{}' pnpm dev -- gate context` runs without error.
  - Done when: `reins gate <event>` is callable from CLI

## 4. Hook generator rewrite

- [ ] **Task 4.1: Rewrite hook generator for gate scripts**
  - Description: Rewrite `src/hooks/generator.ts`. Replace the existing per-constraint template rendering with `generateGateHooks(projectRoot)` that creates 5 unified shell scripts in `.reins/hooks/`: `gate-context.sh`, `gate-pre-edit.sh`, `gate-post-edit.sh`, `gate-pre-bash.sh`, `gate-stop.sh`. Each script is one line: `exec reins gate <event>`. Also keep `generateProtectionHook()` unchanged. Remove the old template constants (POST_EDIT_CHECK_TMPL, BASH_GUARD_TMPL, PRE_COMPLETE_TMPL, CONTEXT_INJECT_TMPL) and per-constraint `renderTemplate()`.
  - Files: `src/hooks/generator.ts`
  - Tests: Unit test that `generateGateHooks()` creates 5 scripts in `.reins/hooks/`. Unit test that each script contains `reins gate <event>`. Unit test that `protect-constraints.sh` is still generated. Unit test that old per-constraint scripts are not created.
  - Done when: Hook generator produces 5 gate scripts + protection script; old templates removed

- [ ] **Task 4.2: Simplify settings writer**
  - Description: Update `src/hooks/settings-writer.ts` to register per-event hooks instead of per-constraint hooks. PreToolUse gets 2 entries: `Edit|Write` matcher (protect-constraints.sh + gate-pre-edit.sh) and `Bash` matcher (gate-pre-bash.sh). PostToolUse gets 1 entry: `Edit|Write` (gate-post-edit.sh). UserPromptSubmit gets 1 entry: gate-context.sh. Stop gets 1 entry: gate-stop.sh. Simplify `buildReinsEntries()` to accept the fixed gate hook list instead of iterating constraints.
  - Files: `src/hooks/settings-writer.ts`
  - Tests: Unit test that generated settings.json has exactly 4 event types with correct matchers. Unit test that protection hook is first in PreToolUse Edit|Write. Unit test that existing user hooks are preserved (not overwritten). Unit test merge with existing settings.json.
  - Done when: Settings.json has clean per-event structure; user hooks preserved

## 5. Init command integration

- [ ] **Task 5.1: Update init to use gate hooks**
  - Description: Update `src/commands/init.ts` to call `generateGateHooks()` instead of `generateHooks()`. Update the import. The function signature change is: old `generateHooks(projectRoot, constraintsPath)` returns `HookConfig[]`, new `generateGateHooks(projectRoot)` returns `HookConfig[]` (no longer needs constraintsPath because gate loads constraints at runtime). Update the summary output to show "5 gate hooks generated" instead of constraint count.
  - Files: `src/commands/init.ts`
  - Tests: Integration test: run initCommand on a temp project → assert `.reins/hooks/gate-context.sh` exists. Assert `.claude/settings.json` has UserPromptSubmit hook entry. Assert no old per-constraint scripts.
  - Done when: `reins init` generates gate hooks and registers them in settings.json

## 6. Config extension

- [ ] **Task 6.1: Add gate config to ReinsConfig**
  - Description: Add `gate` section to `ReinsConfig` in `src/state/config.ts`: `gate: { stop_skip_test: boolean, stop_skip_lint: boolean, context_max_knowledge: number, context_max_skills: number }`. Defaults: `stop_skip_test: true`, `stop_skip_lint: false`, `context_max_knowledge: 5`, `context_max_skills: 3`. These control gate behavior without modifying constraints.yaml.
  - Files: `src/state/config.ts`
  - Tests: Unit test that `getDefaultConfig().gate.stop_skip_test` is true. Unit test that config loads from `.reins/config.yaml` with custom gate settings.
  - Done when: Gate config section available; defaults set

## 7. Tests and verification

- [ ] **Task 7.1: Gate integration tests**
  - Description: Create `src/gate/gate.test.ts` with integration tests covering the full gate flow. Test 1: Create temp project with constraints.yaml containing a `post_edit` constraint with `hook_check: 'console\\.log'`. Set `CLAUDE_TOOL_INPUT` with file containing `console.log`. Call `gatePostEdit()` → assert blocked. Test 2: Create temp project with knowledge entry of type 'gotcha'. Call `gateContext()` with related prompt → assert knowledge appears in output. Test 3: Call `gatePreBash()` with safe command → assert allow. Test 4: Mock git diff with 2 modules → call `captureKnowledgeFromDiff()` → assert coupling entry in knowledge store.
  - Files: `src/gate/gate.test.ts`
  - Tests: As described above; all existing tests still pass.
  - Done when: Gate integration tests cover core flows; `pnpm test` all pass

- [ ] **Task 7.2: Update existing hook tests**
  - Description: Update `src/hooks/hooks.test.ts` to test the new `generateGateHooks()` function instead of the old `generateHooks()`. Remove tests for per-constraint template rendering. Add tests for gate script content. Keep `generateSettingsJson` tests but update expectations for per-event structure.
  - Files: `src/hooks/hooks.test.ts`
  - Tests: All hook tests pass with new gate-based implementation.
  - Done when: Hook tests updated; `pnpm test` all pass

- [ ] **Task 7.3: Full verification**
  - Description: Run `pnpm lint`, `pnpm typecheck`, `pnpm test`. Verify no regressions. Run `pnpm dev -- init` on a test project and verify: `.reins/hooks/` contains 6 files (5 gate + 1 protection), `.claude/settings.json` has correct hook registrations, `reins gate context` runs without error when `CLAUDE_TOOL_INPUT='{"prompt":"test"}'`.
  - Files: none (verification only)
  - Tests: All pass.
  - Done when: Clean lint, typecheck, test run; manual init produces correct output
