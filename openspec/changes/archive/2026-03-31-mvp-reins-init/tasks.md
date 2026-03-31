## Tasks

- [ ] **Task 1: Create src/commands/ directory and init.ts skeleton**
  - Description: Create `src/commands/init.ts` with the exported `initCommand(projectRoot: string, opts: InitOptions): Promise<void>` function and `InitOptions` interface (`depth: string`, `dryRun: boolean`, `force: boolean`). Also export `runInitPipeline` as an alias for testing. Wire `src/cli.ts` to import and call `initCommand` — replace the existing stub `.action()`.
  - Files: `src/commands/init.ts`, `src/cli.ts`
  - Tests: `tsx src/cli.ts init --help` shows `--depth`, `--dry-run`, `--force` options; `pnpm typecheck` exits 0
  - Done when: Commander.js help output lists all three flags with correct descriptions and defaults

- [ ] **Task 2: Implement scaffoldReinsDirs()**
  - Description: Implement `scaffoldReinsDirs(projectRoot: string): void` in `src/commands/init.ts`. Create `.reins/` and all subdirectories (`hooks/`, `patterns/`, `snapshots/`, `logs/`, `skills/auto/`) using `fs.mkdirSync({ recursive: true })`. Write `.reins/config.yaml` with default config YAML (only if absent). Write `.reins/README.md` explaining the directory layout (only if absent). Patch the project's `.gitignore`: read existing content, check for reins personal-file entries, append a `# reins (personal files)` block with the personal file paths if any are missing.
  - Files: `src/commands/init.ts`
  - Tests: Unit test running `scaffoldReinsDirs` on a temp directory; assert all 6 subdirs created; assert `config.yaml` written; assert `.gitignore` contains the personal file entries; assert running a second time does not overwrite existing `config.yaml`.
  - Done when: All assertions pass; idempotent (safe to run twice); `pnpm typecheck` exits 0

- [ ] **Task 3: Implement scan step and scan summary output**
  - Description: In `initCommand`, after scaffolding, call `scan(projectRoot, opts.depth, config)` from `src/scanner/index.ts`. Print the scan summary to stdout matching the format from `08-interaction-design.md`: `✓ Stack: {language} + {framework}`, `✓ Package manager: {packageManager}`, `✓ Test framework: {testFramework}`, `✓ Architecture: {pattern} ({layers joined})`. Use plain `process.stdout.write` with ANSI `\x1b[32m✓\x1b[0m` for green check marks. Print `Scanning project...` before the scan starts.
  - Files: `src/commands/init.ts`
  - Tests: Unit test `printScanSummary(context)` with a known mock context; assert the output string contains the expected stack values. Integration test running `initCommand` with `--dry-run` on the reins project itself; assert scan completes without error.
  - Done when: Scan summary prints correctly; check marks are green in a TTY; `pnpm typecheck` exits 0

- [ ] **Task 4: Implement constraint generation step and constraint summary output**
  - Description: Call `generateConstraints(context, projectRoot)` from `src/constraints/index.ts`. Print constraint summary: `Inferred {N} constraints: {X} critical  •  {Y} important  •  {Z} helpful`. Then print the `Files to write:` list: each file that would be written by `generateContext()` and `runAdapters()`, relative to projectRoot.
  - Files: `src/commands/init.ts`
  - Tests: Unit test `printConstraintSummary(constraints)` with a known constraint array; assert counts are correct. Assert the files-to-write list includes `constraints.yaml`, `CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md`, `.windsurfrules`.
  - Done when: Summary output matches the format in `08-interaction-design.md`; file list is complete and accurate

- [ ] **Task 5: Implement interactive confirmation prompt**
  - Description: After printing the summary, if `process.stdout.isTTY` is true and `opts.dryRun` is false, prompt `Proceed? [Y/n] `. Read a single line from `process.stdin`. Accept `y`, `Y`, or empty enter as confirmation; `n` or `N` as cancellation. If cancelled, print `Aborted.` and return without writing files. If non-TTY, skip the prompt, print `(non-interactive mode, auto-confirming)`, and proceed.
  - Files: `src/commands/init.ts`
  - Tests: Unit test the confirmation logic by mocking `process.stdin`; assert `y` proceeds and `n` returns early. Unit test non-TTY path: assert no prompt is shown and execution continues.
  - Done when: TTY confirmation works; non-TTY auto-confirms; `n` prevents any file writes

- [ ] **Task 6: Implement dry-run mode**
  - Description: If `opts.dryRun` is true, after generating constraints call `generateDryRunPreview(projectRoot, constraints, context)`. This function calls `generateContext()` and `runAdapters()` with a mock filesystem that captures writes instead of writing to disk. Print each file that would be written with its full content under a `--- DRY RUN: {filepath} ---` header. Then print `Dry run complete. No files were written.` and return.
  - Files: `src/commands/init.ts`
  - Tests: Run `initCommand('/tmp/some-project', { dryRun: true, depth: 'L0-L2', force: false })`; assert no files are written to disk; assert stdout contains `--- DRY RUN:` headers for at least `CLAUDE.md` and `constraints.yaml`.
  - Done when: No disk writes in dry-run mode; preview output shows all files that would be written

- [ ] **Task 7: Implement full pipeline execution and completion summary**
  - Description: In the non-dry-run confirmed path, call in sequence: `writeConstraintsFile()`, `generateContext()`, `runAdapters()`. Collect results. Print completion summary: `✓ Written {N} files:` followed by a list of each written file path. Print `Skipped {M} files (already up to date):` if any adapters returned `skipped: true`. Print the Reins-ready footer: `Reins is ready. Constraints will be applied automatically via CLAUDE.md.`
  - Files: `src/commands/init.ts`
  - Tests: Integration test running `initCommand` on a real temp directory with a `package.json` containing TypeScript deps; assert `.reins/constraints.yaml` exists and is valid YAML; assert `CLAUDE.md` exists; assert `.cursorrules` exists; assert completion summary is printed.
  - Done when: All output files written; completion summary accurate; `pnpm typecheck` exits 0; `pnpm test` passes all tests added in this change

- [ ] **Task 8: End-to-end smoke test against the reins project itself**
  - Description: Write an integration test that runs `runInitPipeline(reinsProjRoot, { depth: 'L0-L2', dryRun: true, force: false })` against `/Users/kids/Documents/reins` (or a copy of it). Assert: scan detects TypeScript as primary language; at least 3 constraints are generated; dry-run prints CLAUDE.md content; no files are modified on disk.
  - Files: `src/commands/init.test.ts`
  - Tests: The integration test itself
  - Done when: Test passes without modifying any files in the reins repo; scan correctly identifies the TypeScript project structure
