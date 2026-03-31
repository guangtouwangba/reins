## Tasks

- [ ] **Task 1: Create L3 AST analyzer (`scanner/ast-analyzer.ts`)**
  - Description: Create `src/scanner/ast-analyzer.ts`. Export `analyzeAST(projectRoot: string, sampleSize?: number): ASTAnalysis` (default sampleSize: 8). Select representative files: entry points detected by L0 scan + files with highest import frequency. For TypeScript/JavaScript, use `@typescript-eslint/parser` to parse each file and walk the AST. Extract: `importPatterns` (relative vs absolute vs alias ratio), `errorHandlingStyle` (try/catch count vs Result-type usage count), `typeAnnotationDensity` (annotated return types / total function declarations), `recurringIdioms` (top 10 repeated 3-node call expression patterns by frequency). For non-TS/JS projects, return a partial result with only the fields extractable via regex. Define and export `ASTAnalysis` interface.
  - Files: `src/scanner/ast-analyzer.ts`
  - Tests: Unit test with a fixture TypeScript file containing known patterns — verify `errorHandlingStyle` counts match; unit test that non-existent files are skipped without error; unit test that `typeAnnotationDensity` is 0 when no functions have return type annotations
  - Done when: Parses without throwing on valid TS; gracefully skips unreadable files; all `ASTAnalysis` fields populated; `tsc --noEmit` 0 errors

- [ ] **Task 2: Create L4 git analyzer (`scanner/git-analyzer.ts`)**
  - Description: Create `src/scanner/git-analyzer.ts`. Export `analyzeGitHistory(projectRoot: string, days?: number): GitAnalysis` (default days: 30). Run `git log --since=<N>d --name-only --pretty=format:` via `execa` from `projectRoot`. Parse the output to count commits per file and per directory. Compute `hotDirectories[]` (top 5 directories by commit count) and `highChurnFiles[]` (top 10 files by commit count). Count unique authors for `activeContributors`. Return `GitAnalysis { hotDirectories, highChurnFiles, activeContributors, totalCommits }`. Gracefully return an empty result if `.git` directory does not exist.
  - Files: `src/scanner/git-analyzer.ts`
  - Tests: Unit test against a fixture git repo with known commit history — verify `hotDirectories` matches expected top directory; unit test in a directory without `.git` returns empty result without throwing; unit test that `totalCommits` matches the number of commits in the fixture
  - Done when: Handles non-git directories; top-N sorting correct; `tsc --noEmit` 0 errors

- [ ] **Task 3: Create L5 LLM analyzer (`scanner/llm-analyzer.ts`)**
  - Description: Create `src/scanner/llm-analyzer.ts`. Export `analyzeLLM(sampleFiles: string[], config: ReinsConfig): Promise<LLMAnalysis>`. Select at most 4 files, truncate each to 500 lines. Build a structured prompt asking for: module responsibilities (one sentence per file), key design patterns, implicit conventions not visible in config files, and areas of complexity. Call the configured LLM (default model: haiku). Parse structured response into `LLMAnalysis { moduleDescriptions: Record<string, string>, designPatterns: string[], implicitConventions: string[], complexityHotspots: string[] }`. Return an empty `LLMAnalysis` if `config.scan.depth` is not `'l5'`.
  - Files: `src/scanner/llm-analyzer.ts`
  - Tests: Unit test with `config.scan.depth: 'l2'` — verify returns empty analysis without calling LLM; unit test that files longer than 500 lines are truncated before sending; unit test that a malformed LLM response returns an empty analysis without throwing
  - Done when: Depth guard works; file truncation correct; empty-response handling safe; `tsc --noEmit` 0 errors

- [ ] **Task 4: Extend `scanner/index.ts` with depth dispatch and monorepo detection**
  - Description: Update `scan(projectRoot: string, depth?: ScanDepth): CodebaseContext`. Add `ScanDepth` type: `'l2' | 'l3' | 'l4' | 'l5'`. Default: `'l2'` (existing behavior unchanged). When depth is `'l3'` or higher, call `analyzeAST()` and merge result into `context.conventions`. When depth is `'l4'` or higher, also call `analyzeGitHistory()` and attach as `context.gitAnalysis`. When depth is `'l5'`, also call `analyzeLLM()` and attach as `context.llmAnalysis`. Add monorepo detection: if `packages/` or `apps/` directories exist, set `context.architecture.pattern = 'monorepo'` and populate `context.architecture.packages[]` with package directory paths.
  - Files: `src/scanner/index.ts`
  - Tests: Unit test that `scan(root, 'l2')` does not invoke AST or git analyzers; unit test that `scan(root, 'l3')` invokes AST analyzer; unit test that a fixture directory with `packages/` subdirectory sets pattern to `'monorepo'` and populates `packages[]`
  - Done when: All depth levels dispatch correctly; monorepo detection works; L0-L2 behavior unchanged for default depth; `tsc --noEmit` 0 errors

- [ ] **Task 5: Create cross-project learning module (`learn/cross-project.ts`)**
  - Description: Create `src/learn/cross-project.ts`. Export `extractGlobalSkills(projectRoot: string, skills: SkillEntry[]): void`. For each skill with `quality >= 95`: scan content for project-specific path strings (matching `projectRoot` or entries from `context.architecture.packages[]`); if none found, strip any remaining absolute paths, tag with stack from the project fingerprint, write to `~/.dev-harness/global-skills/<primaryStack>/<skill-name>.yaml`, append to `~/.dev-harness/transfer-log.json`. Export `injectGlobalSkills(projectRoot: string, stack: StackInfo): SkillEntry[]`: read `~/.dev-harness/global-skills/`, filter by stack match, copy to `.reins/skills/` with `quality: 50` and `source: 'global'`, return injected list. Export `writeFingerprint(projectRoot: string, context: CodebaseContext): void`: write `~/.dev-harness/project-profiles/<projectName>.json`.
  - Files: `src/learn/cross-project.ts`
  - Tests: Unit test that a skill with a project-specific path reference is NOT extracted globally; unit test that a clean skill IS written to `~/.dev-harness/global-skills/`; unit test that `injectGlobalSkills` copies matching skills with quality reset to 50; unit test that `writeFingerprint` creates the profile file with correct stack fields
  - Done when: Path dependency detection works; quality reset on injection; fingerprint written; `tsc --noEmit` 0 errors

- [ ] **Task 6: Create constraint version migrator (`constraints/migrator.ts`)**
  - Description: Create `src/constraints/migrator.ts`. Export `migrate(projectRoot: string): void`. Read `constraints.yaml` and check `version` field. If version matches current (no migration needed), return immediately. Otherwise: write backup to `.reins/backups/constraints-v<version>-<timestamp>.yaml`. Apply each migration function in sequence (e.g. `MIGRATIONS['v1→v2'](constraints)`). Write migrated constraints back to `constraints.yaml`. Append changelog entry. Register at least one placeholder migration (`v1→v2`) that adds a missing `version: 2` field if absent. Call `migrate()` at the start of `reins update` and `reins init`.
  - Files: `src/constraints/migrator.ts`, `src/cli.ts`
  - Tests: Unit test with a v1 constraints fixture — verify backup is written before migration; verify `constraints.yaml` has `version: 2` after migration; unit test with already-current version — verify no backup is written and function returns immediately
  - Done when: Backup always written before any mutation; migration chain applies in order; idempotent for current version; `tsc --noEmit` 0 errors

- [ ] **Task 7: Add monorepo per-package constraint generation**
  - Description: In the `reins init` command handler, after running the root scan: if `context.architecture.pattern === 'monorepo'`, iterate `context.architecture.packages[]`. For each package directory, run `scan(packageDir, 'l2')` to get package-specific context. Generate a package `constraints.yaml` using the constraint generator, prepending `extends: ../../.reins/constraints.yaml` (relative path to root). Write to `<packageDir>/.reins/constraints.yaml`. Do not overwrite if file already exists (print a warning instead).
  - Files: `src/cli.ts` (init command handler), `src/constraints/` (generator, extends support)
  - Tests: Integration test with a fixture monorepo containing two packages — verify both `<pkg>/.reins/constraints.yaml` files are created with the `extends` field; verify root `.reins/constraints.yaml` is also created; verify re-running init does not overwrite existing package files
  - Done when: Per-package files created; `extends` field points to root; existing files not overwritten; `tsc --noEmit` 0 errors

- [ ] **Task 8: Add community template fetching to `reins init`**
  - Description: In the `reins init` flow, after scanning but before writing constraints: if `init.community_templates !== false` in config, call `fetchCommunityTemplates(stack)`. Make a GET to `https://templates.reins.dev/v1/match` with `{ stack }` as query params (or body). If the request fails or times out (5s), skip silently and log a debug message. If templates are returned, print the top 3 with their names and descriptions, ask the user to select one or skip. If selected, download the template YAML, validate its `version` and `rules` fields, and use it as the base for `constraints.yaml` generation instead of the empty template.
  - Files: `src/cli.ts` (init command handler)
  - Tests: Unit test that a network timeout skips templates and continues init without error; unit test that a selected template's rules appear in the generated `constraints.yaml`; unit test that an invalid template schema is rejected with an informative error
  - Done when: Network failure is non-fatal; template selection is interactive; invalid schemas rejected; init completes successfully with or without template; `tsc --noEmit` 0 errors
