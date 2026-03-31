## Tasks

- [ ] **Task 1: Implement l0-generator.ts**
  - Description: Implement `generateL0(projectRoot: string, context: CodebaseContext, constraints: Constraint[]): void`. Filter critical constraints (max 5). Build the 6-section template: project name, stack one-liner, commands block (dev/test/lint/typecheck from context.stack), critical rules bullets, project map from context.structure (max 10 lines), Reins navigation footer. Enforce 50-line hard cap by truncating project map then rules. Handle existing CLAUDE.md: if it contains `<!-- reins-managed -->`, replace that section; if it exists without the marker, append a new `## Reins` section; if absent, write the full file.
  - Files: `src/context/l0-generator.ts`
  - Tests: Unit test with 3 critical constraints; assert output is ≤ 50 lines. Unit test with 10 critical constraints; assert only 5 appear in output. Unit test CLAUDE.md injection: existing file with no marker gets the section appended; existing file with marker gets the section replaced without touching other content.
  - Done when: All three test cases pass; output always ≤ 50 lines; `pnpm typecheck` exits 0

- [ ] **Task 2: Implement buildDirectoryProfiles() in l1-generator.ts**
  - Description: Implement `buildDirectoryProfiles(context: CodebaseContext, constraints: Constraint[]): DirectoryProfile[]`. Known layer names to detect: `app`, `lib`, `src`, `components`, `services`, `api`, `repositories`, `controllers`, `models`, `hooks`, `utils`. Also include any directory referenced in `constraint.scope` as `directory:{path}`. For each found directory, assign `purpose` from a lookup table (e.g., `services` → "Business logic and service layer", `api` → "API route handlers"). Set `keyFiles` to the first 5 files found in that directory from `context.structure`. Set `patternRef` to the best-matching L2 topic (e.g., `services` → `api-patterns`).
  - Files: `src/context/l1-generator.ts`
  - Tests: Unit test with a context where `architecture.layers = ['api', 'services']`; assert two profiles returned with correct purposes. Unit test with a constraint scoped to `directory:lib/queue/`; assert that directory is included even if not in known layers.
  - Done when: Both unit tests pass; unknown directories get a generic purpose fallback; no crash on empty structure

- [ ] **Task 3: Implement generateL1() in l1-generator.ts**
  - Description: Implement `generateL1(projectRoot: string, constraints: Constraint[], directories: DirectoryProfile[]): void`. For each profile, filter constraints to important severity AND (global scope OR matching directory scope). Take first 5. Render the template from module ④: `# {path} — {purpose}`, `## Purpose`, `## Rules for This Directory`, `## Key Files`, `## Patterns` pointer. Enforce 30-line hard cap: drop key files section if over limit, then truncate rules to 3. Write to `{projectRoot}/{dir.path}/AGENTS.md`. Skip if the directory does not exist on disk.
  - Files: `src/context/l1-generator.ts`
  - Tests: Unit test renders correct content for a service directory with 3 important constraints. Unit test with 10 important constraints; assert output ≤ 30 lines. Unit test that skips writing when directory does not exist.
  - Done when: All three test cases pass; output always ≤ 30 lines; non-existent directories are silently skipped

- [ ] **Task 4: Implement l2-generator.ts**
  - Description: Implement `groupConstraintsByTopic(constraints: Constraint[]): Map<string, Constraint[]>`. Use keyword matching on `constraint.rule` text: api/route/endpoint → `api-patterns`; test/coverage/fixture → `testing-patterns`; error/exception/throw → `error-handling`; import/module/dependency → `module-patterns`; fallback → `general-patterns`. Implement `generateL2(projectRoot: string, constraints: Constraint[], context: CodebaseContext): void`. Filter to helpful severity. Group by topic. Write one `.reins/patterns/{topic}.md` per group. Create `.reins/patterns/` directory if absent. No line limit.
  - Files: `src/context/l2-generator.ts`
  - Tests: Unit test `groupConstraintsByTopic` with constraints containing "API route handler" and "test coverage"; assert correct topic assignments. Unit test `generateL2` writes the correct number of files for a mixed set of helpful constraints.
  - Done when: Topic grouping works; all topic files written; `pnpm typecheck` exits 0

- [ ] **Task 5: Implement generateContext() entry point**
  - Description: Implement `generateContext(projectRoot: string, constraints: Constraint[], context: CodebaseContext, depth: string): void` in `src/context/index.ts`. Always call `generateL0`. Call `generateL1` if depth includes `L1` or `L2`. Call `generateL2` if depth includes `L2`. Return a summary object `{ l0Written: boolean; l1Files: string[]; l2Files: string[] }` for display by the CLI.
  - Files: `src/context/index.ts`
  - Tests: Unit test that `depth = 'L0'` only calls l0-generator. Unit test that `depth = 'L0-L2'` calls all three generators.
  - Done when: Depth gating works correctly; summary object contains accurate file paths; `pnpm typecheck` exits 0

- [ ] **Task 6: Integration test the full context generation pipeline**
  - Description: Write an integration test that creates a temp directory with a known structure, generates a mock `CodebaseContext` and `Constraint[]`, calls `generateContext()`, and asserts: `CLAUDE.md` exists and is ≤ 50 lines; at least one `AGENTS.md` file is written in a subdirectory; `.reins/patterns/` contains at least one `.md` file; all generated files contain the expected constraint text.
  - Files: `src/context/index.test.ts`
  - Tests: The integration test itself
  - Done when: Integration test passes; no file-system artifacts left behind after test (temp dir cleaned up)
