## Tasks

- [ ] **Task 1: Define new types (`CommandMap`, `ResolvedCommand`, `PackageInfo`)**
  - Description: Add `ResolvedCommand`, `CommandMap`, and `PackageInfo` interfaces to `src/scanner/types.ts`. Extend `CodebaseContext` with `commands: CommandMap` and `packages: PackageInfo[]`. Add `emptyCommandMap()` helper that returns all-null fields. Update `emptyCodebaseContext()` to include `commands: emptyCommandMap()` and `packages: []`. Re-export new types from `src/scanner/index.ts`.
  - Files: `src/scanner/types.ts`, `src/scanner/index.ts`
  - Tests: `pnpm typecheck` exits 0; write a test that `emptyCodebaseContext()` has `commands` and `packages` fields with correct shapes
  - Done when: All new interfaces defined; `emptyCodebaseContext()` updated; no TypeScript errors; existing tests still pass

- [ ] **Task 2: Rename `projectRoot` to `contextRoot` in sub-detectors**
  - Description: In `stack-detector.ts`, `test-detector.ts`, and `rule-detector.ts`, rename the `projectRoot` parameter to `contextRoot` in all exported functions. Update all call sites in `scan.ts`. No logic change — pure mechanical rename. This enables the same functions to be called with a per-package root.
  - Files: `src/scanner/stack-detector.ts`, `src/scanner/test-detector.ts`, `src/scanner/rule-detector.ts`, `src/scanner/scan.ts`
  - Tests: `pnpm test` — all existing scanner tests pass unchanged
  - Done when: Grep for `projectRoot` in `stack-detector.ts`, `test-detector.ts`, `rule-detector.ts` returns zero matches; all tests pass

- [ ] **Task 3: Implement workspace detector — JS resolvers (pnpm, npm/yarn)**
  - Description: Create `src/scanner/workspace-detector.ts`. Define `WorkspaceResolver` and `PackageEntry` interfaces. Implement `pnpmResolver`: detect `pnpm-workspace.yaml`, parse YAML `packages` field, expand globs, filter for dirs containing `package.json`, read `name` from each `package.json`. Implement `npmYarnResolver`: detect root `package.json` has `workspaces` field, expand globs, same filtering. Implement shared `expandGlobs(root, patterns): string[]` utility using `glob.sync`. Export `detectWorkspaces(projectRoot, filePaths, dirPaths): PackageEntry[]` that tries resolvers in order.
  - Files: `src/scanner/workspace-detector.ts`
  - Tests: Unit test with a fixture directory containing `pnpm-workspace.yaml` pointing to `packages/*`, with two sub-dirs each having `package.json` — assert two `PackageEntry` items returned with correct names and paths. Unit test with `package.json` having `workspaces: ["apps/*"]` — assert packages found. Unit test with no workspace config — assert empty array returned.
  - Done when: Both JS resolvers work; empty project returns []; globs expand correctly

- [ ] **Task 4: Implement workspace detector — Go, Rust, Python resolvers**
  - Description: Add `goWorkResolver`: detect `go.work`, parse `use` directives (line-based regex: `/^\s*\.\/(.+)/`), filter dirs containing `go.mod`, read module path from first line of `go.mod`. Add `cargoResolver`: detect `Cargo.toml` contains `[workspace]` (string check), parse TOML `workspace.members`, expand globs, filter dirs containing `Cargo.toml` with `[package]`, read `package.name`. Add `uvResolver`: detect `pyproject.toml` contains `[tool.uv.workspace]`, parse TOML `tool.uv.workspace.members`, expand globs, filter dirs containing `pyproject.toml`, read `project.name`. Add `poetryResolver`: detect `pyproject.toml` has path dependencies in `tool.poetry.group.*.dependencies`, extract paths. Add `smol-toml` dependency for TOML parsing.
  - Files: `src/scanner/workspace-detector.ts`, `package.json` (add `smol-toml`)
  - Tests: Unit test per resolver with a fixture directory matching its config format — assert correct packages found. Unit test for `go.work` with `use (./api ./worker)` syntax. Unit test for `Cargo.toml` workspace with `members = ["crates/*"]`.
  - Done when: All four resolvers detect and resolve correctly; TOML parsing works for Cargo.toml and pyproject.toml

- [ ] **Task 5: Implement workspace detector — Flutter/Dart resolvers + fallback**
  - Description: Add `dartPubResolver`: detect root `pubspec.yaml` has `workspace` field, parse YAML list, filter dirs containing `pubspec.yaml` with `resolution: workspace`, read `name`. Add `melosResolver`: detect `melos.yaml`, parse `packages` globs, filter dirs containing `pubspec.yaml`, read `name`. Add fallback heuristic: if no resolver matched but `packages/`, `apps/`, or `modules/` directories exist, scan their subdirectories for any known project marker (`package.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`, `pubspec.yaml`).
  - Files: `src/scanner/workspace-detector.ts`
  - Tests: Unit test for `pubspec.yaml` with `workspace: [packages/shared, packages/client]`. Unit test for `melos.yaml` with `packages: ['packages/**']`. Unit test for fallback: directory with `packages/foo/package.json` but no workspace config — assert fallback finds it.
  - Done when: Dart resolvers work; fallback covers informal monorepos; resolver priority order is correct (pnpm → npm/yarn → go → cargo → uv → poetry → dart → melos → fallback)

- [ ] **Task 6: Implement command resolver — JS/TS**
  - Description: Create `src/scanner/command-resolver.ts`. Define `LanguageCommandResolver` interface. Implement `jsResolver`: read `package.json#scripts` at `contextRoot`, map script keys to `CommandMap` fields using candidate lists (e.g., `['dev', 'start', 'serve']` for `dev`). Build command strings using `${pmRun} ${scriptKey}`. Implement derived commands: if `lintFix` not found and `lint` script contains `eslint` → derive `${run} lint -- --fix`; if `testSingle` not found and `test` contains `vitest` → `${pm} vitest run {file}`; if `test` contains `jest` → `${pm} jest {file}`. Always set `install` from packageManager. Export `resolveCommands(contextRoot, filePaths, stack): CommandMap`.
  - Files: `src/scanner/command-resolver.ts`
  - Tests: Unit test with fixture `package.json` having `scripts: { dev, build, lint, test, typecheck }` — assert all CommandMap fields populated with correct `${pmRun}` prefix. Unit test with `scripts: { test: "vitest" }` — assert `testSingle` derived as `pnpm vitest run {file}`. Unit test with no `package.json` — assert all fields null. Unit test for `lintFix` derivation when explicit script missing.
  - Done when: All JS script mappings work; derivation logic correct; empty project returns empty map

- [ ] **Task 7: Implement command resolver — Go**
  - Description: Implement `goResolver` in `command-resolver.ts`. Convention defaults: `install` = `go mod tidy`, `build` = `go build ./...`, `test` = `go test ./...`, `testSingle` = `go test {file}` (where `{file}` is a package path like `./pkg/auth/...`), `format` = `gofmt -w .`, `formatCheck` = `gofmt -l .`, `clean` = `go clean`. If `.golangci.yml` or `.golangci.yaml` exists: `lint` = `golangci-lint run` (confidence 0.8), `lintFix` = `golangci-lint run --fix`. Convention commands get confidence 0.6.
  - Files: `src/scanner/command-resolver.ts`
  - Tests: Unit test with `go.mod` + `.golangci.yml` — assert lint commands set with config source. Unit test without `.golangci.yml` — assert lint is null. Unit test that convention commands have confidence 0.6.
  - Done when: All Go conventions mapped; linter detection works; confidence values correct

- [ ] **Task 8: Implement command resolver — Rust**
  - Description: Implement `rustResolver` in `command-resolver.ts`. Convention defaults: `build` = `cargo build`, `test` = `cargo test`, `testSingle` = `cargo test {name}`, `lint` = `cargo clippy -- -D warnings`, `lintFix` = `cargo clippy --fix --allow-dirty`, `format` = `cargo fmt`, `formatCheck` = `cargo fmt --check`, `clean` = `cargo clean`, `install` = `cargo fetch` (confidence 0.5). All convention commands confidence 0.8 (Rust conventions are near-universal).
  - Files: `src/scanner/command-resolver.ts`
  - Tests: Unit test with `Cargo.toml` present — assert all fields populated. Unit test that confidence values are 0.8 for convention commands.
  - Done when: All Rust conventions mapped; confidence reflects universal adoption

- [ ] **Task 9: Implement command resolver — Python**
  - Description: Implement `pythonResolver` in `command-resolver.ts`. Detect runner prefix: `uv.lock` → `uv run `, `poetry.lock` → `poetry run `, else empty. Detect install: `uv.lock` → `uv sync`, `poetry.lock` → `poetry install`, else `pip install -e .`. Detect lint tool: check for `ruff.toml`, `.ruff.toml`, or TOML `[tool.ruff]` in `pyproject.toml` → ruff commands; else check for `.flake8` or `[tool.flake8]` → flake8 commands. Detect type checker: `mypy.ini` or `[tool.mypy]` → `${prefix}mypy .`; `pyrightconfig.json` or `[tool.pyright]` → `${prefix}pyright`. Test: `${prefix}pytest`, `testSingle` = `${prefix}pytest {file}`. Parse `[project.scripts]` in `pyproject.toml` for explicit script commands — if a key matches a CommandMap field, use it (source: script, confidence: 1.0) overriding conventions.
  - Files: `src/scanner/command-resolver.ts`
  - Tests: Unit test with `uv.lock` + `ruff.toml` — assert `uv run ruff check .` for lint and `uv run pytest` for test. Unit test with `poetry.lock` + `mypy.ini` — assert `poetry run mypy .` for typecheck. Unit test with bare Python (no lock file) — assert no prefix. Unit test with `pyproject.toml` `[project.scripts]` having `lint = "ruff check src"` — assert overrides convention.
  - Done when: All three runner prefixes detected; ruff/flake8/mypy/pyright detection works; pyproject.toml scripts override conventions

- [ ] **Task 10: Implement command resolver — Flutter/Dart**
  - Description: Implement `flutterResolver` in `command-resolver.ts`. Detect FVM: `.fvmrc` or `.fvm/fvm_config.json` → prefix `fvm flutter`, else `flutter`. Convention defaults: `install` = `${flutter} pub get`, `dev` = `${flutter} run`, `build` = `${flutter} build`, `test` = `${flutter} test`, `testSingle` = `${flutter} test {file}`, `lint` = `${flutter} analyze`, `lintFix` = `dart fix --apply`, `format` = `dart format .`, `formatCheck` = `dart format --set-exit-if-changed .`, `clean` = `${flutter} clean`. Convention confidence 0.8.
  - Files: `src/scanner/command-resolver.ts`
  - Tests: Unit test with `pubspec.yaml` + `.fvmrc` — assert `fvm flutter test` for test. Unit test without FVM — assert `flutter test`. Unit test that `dart fix --apply` is set for lintFix.
  - Done when: FVM detection works; all Flutter conventions mapped; confidence correct

- [ ] **Task 11: Implement Makefile parser and taskrunner overlay**
  - Description: Add `parseMakefileTargets(makefilePath): Record<string, string>` to `command-resolver.ts`. Line-based parser: match `/^([a-zA-Z_-]+):/`, extract first tab-indented line as command body. Map known target names to CommandMap fields (`test`→test, `lint`→lint, `build`→build, `dev`/`run`→dev, `fmt`/`format`→format, `clean`→clean, `check`→typecheck, `install`→install). Add taskrunner overlay: if `turbo.json` exists, parse `tasks` object, for each task name matching a CommandMap field → set command to `turbo run <name>` with source `taskrunner`. If `nx.json` exists with `targetDefaults`, map targets via `nx run-many --target=<name>`. If `melos.yaml` has `scripts`, map script names. Taskrunner commands override all lower layers.
  - Files: `src/scanner/command-resolver.ts`
  - Tests: Unit test with fixture Makefile containing `test:` and `lint:` targets — assert commands extracted. Unit test with `turbo.json` having `tasks: { lint: {}, test: {}, build: {} }` — assert turbo commands override JS script commands. Unit test with `melos.yaml` scripts — assert melos commands set.
  - Done when: Makefile targets parsed correctly; turbo/nx/melos override works; source field correctly set to `taskrunner`

- [ ] **Task 12: Implement documentation extractor (`src/scanner/doc-extractor.ts`)**
  - Description: Create `src/scanner/doc-extractor.ts`. Export `extractCommandsFromDocs(projectRoot, filePaths): Partial<CommandMap>`. Scan `README.md`, `CONTRIBUTING.md`, `docs/development.md` (first 3 found). For each file, find headings or bold labels matching known patterns (e.g., `/(?:run|execute)\s+(?:the\s+)?tests?/i` for test, `/(?:run\s+)?lint/i` for lint, `/(?:start|run)\s+(?:the\s+)?dev/i` for dev, `/install\s+dep/i` for install, `/build|compile/i` for build). Within 5 lines of a matched label, extract commands from inline code backticks or fenced code blocks. Strip `$` prefix from commands. Validate: reject strings that look like file paths, URLs, or output. Return `Partial<CommandMap>` with `source: 'docs'`, `confidence: 0.7`.
  - Files: `src/scanner/doc-extractor.ts`
  - Tests: Unit test with a fixture README containing `## Testing\n\`\`\`bash\ndx test\n\`\`\`` — assert `test.command === 'dx test'`. Unit test with inline code: `Run lint: \`myco lint\`` — assert extracted. Unit test with `$ npm install` — assert `$` stripped. Unit test with no docs — assert empty result. Unit test with irrelevant code blocks (output examples) — assert not extracted.
  - Done when: Extracts commands from headings + code blocks; strips `$`; rejects non-commands; returns empty for missing docs

- [ ] **Task 13: Implement user commands loader (`src/scanner/user-commands.ts`)**
  - Description: Create `src/scanner/user-commands.ts`. Export `loadUserCommands(projectRoot): Partial<CommandMap> | null` — reads `.reins/commands.yaml`, parses the `commands` section, maps keys to `CommandMap` field names, returns `ResolvedCommand` entries with `source: 'user'`, `confidence: 1.0`. Returns null if file doesn't exist. Export `loadUserPackageOverrides(projectRoot): Record<string, Partial<CommandMap>>` — reads the `packages` section. Export `writeUserCommands(projectRoot, commands: Record<string, string>, packages?: Record<string, Record<string, string>>)` — writes `.reins/commands.yaml` with proper YAML formatting. Unknown keys in the YAML are ignored (forward-compatible).
  - Files: `src/scanner/user-commands.ts`
  - Tests: Unit test with fixture `commands.yaml` having `commands: { test: "dx test", lint: "myco lint" }` — assert two `ResolvedCommand` returned with source `user`. Unit test with `packages` section — assert per-package overrides loaded. Unit test with no file — assert null returned. Unit test for `writeUserCommands` — assert valid YAML written and re-loadable. Unit test with unknown keys — assert ignored without error.
  - Done when: Load and write both work; source/confidence correct; missing file handled; round-trip (write then load) produces same data

- [ ] **Task 14: Integrate all command sources into scan()**
  - Description: Modify `src/scanner/scan.ts` to call `detectWorkspaces()` after `scanDirectory()`, then `extractCommandsFromDocs()` and `resolveCommands()` after sub-detectors, then `loadUserCommands()` to apply user overrides. When packages are found, run a per-package loop: scope file lists by `pkg.path` prefix, call all sub-detectors with scoped files and `join(projectRoot, pkg.path)` as `contextRoot`, call `resolveCommands()` per package. After the loop, call `loadUserPackageOverrides()` to apply per-package user overrides. Write updated `context.json` including `commands` and `packages`.
  - Files: `src/scanner/scan.ts`
  - Tests: Integration test running `scan()` against the reins project root — assert `context.commands.test` is populated. Unit test with fixture monorepo (two packages) — assert `context.packages.length === 2` and each has `commands`. Unit test with `.reins/commands.yaml` — assert user commands override auto-detected. Unit test with README containing commands — assert docs layer fills gaps. Unit test with non-monorepo — assert `context.packages` is empty.
  - Done when: Full 6-layer pipeline works end-to-end; user overrides win; doc extraction fills gaps; per-package commands resolved; `context.json` includes new fields; all existing tests pass

- [ ] **Task 15: Implement interactive command prompts in `reins init`**
  - Description: In `src/commands/init.ts`, after `scan()` returns, check `context.commands` for null fields in the critical set (`install`, `dev`, `build`, `lint`, `lintFix`, `test`, `testSingle`). In interactive mode (TTY), display detected commands with sources, then prompt for each null critical command. For `lintFix`, only prompt if `lint` was answered. For `testSingle`, only prompt if `test` was answered. Save answers via `writeUserCommands()`. Merge saved commands into context before constraint generation and CLAUDE.md output. In non-interactive mode (`--no-input`, non-TTY), skip all prompts silently. On `reins update`, skip prompts if `.reins/commands.yaml` already exists.
  - Files: `src/commands/init.ts`
  - Tests: Unit test in non-TTY mode — assert no prompts, unresolved commands stay null. Unit test that already-detected commands are not prompted. Unit test that answers are written to `.reins/commands.yaml`. Unit test that `lintFix` is only prompted when `lint` was answered. Unit test that `reins update` with existing `commands.yaml` does not prompt.
  - Done when: Interactive flow works; non-interactive skips cleanly; answers persisted; conditional prompts correct; context updated before downstream generation

- [ ] **Task 16: Update constraint generator to use `context.commands`**
  - Description: Modify `writeConstraintsFile()` in `src/constraints/generator.ts` to read `context.commands.lint?.command`, `context.commands.typecheck?.command`, `context.commands.test?.command` instead of hardcoding `${pmRun} lint` etc. If a command is null, omit it from the pipeline. For monorepo projects: when `context.packages.length > 0`, iterate packages and write per-package `constraints.yaml` to `<pkg.path>/.reins/constraints.yaml` with `extends` field pointing to root constraints. Skip writing if file already exists (log warning).
  - Files: `src/constraints/generator.ts`
  - Tests: Unit test with context having `commands.lint = null` — assert `pre_commit` array does not contain a lint command. Unit test with context having valid commands — assert pipeline uses actual command strings. Integration test with monorepo context — assert per-package constraint files written with `extends` field.
  - Done when: No hardcoded commands in generator; per-package constraint files created for monorepos; existing non-monorepo behavior unchanged

- [ ] **Task 17: Update evaluation module to consume `context.commands`**
  - Description: Refactor `detectCommands()` in `src/evaluation/l0-static.ts` to accept a `CommandMap` parameter instead of re-parsing `package.json`. Update `runL0Static()` to accept an optional `CommandMap` parameter; when provided, use it instead of calling the old `detectCommands(projectRoot)`. Keep the old signature working as a fallback for backward compatibility (if no `CommandMap` provided, detect from filesystem as before). Remove duplicated script-matching logic.
  - Files: `src/evaluation/l0-static.ts`
  - Tests: Unit test passing a `CommandMap` with `lint.command = 'custom-lint'` — assert `runL0Static` uses `custom-lint` not the re-detected command. Unit test without `CommandMap` — assert fallback detection still works. Existing evaluation tests pass.
  - Done when: Primary path uses `CommandMap`; fallback works; no duplicated detection logic

- [ ] **Task 18: Update CLAUDE.md context generators**
  - Description: Modify the context output generators (`src/context/`) to write a `## Commands` section from `context.commands`. List each non-null command as `- <Label>: \`<command>\``. Annotate based on source: `(declared)` for user commands, `(from docs)` for doc-extracted, `(may need adjustment)` for confidence < 0.7, no annotation for auto-detected scripts/taskrunner. For `lintFix`, append as `(fix: \`<command>\`)` after the lint line. For `testSingle`, append as `(single file: \`<command>\`)` after the test line. For monorepos, add a `## Packages` section listing each package with its name, detected stack summary, and per-package commands.
  - Files: `src/context/l0-generator.ts`, `src/context/l1-generator.ts` (or whichever generators produce CLAUDE.md)
  - Tests: Unit test with a full `CommandMap` — assert Commands section in output contains all commands. Unit test with `source: 'user'` — assert `(declared)` annotation. Unit test with `source: 'docs'` — assert `(from docs)` annotation. Unit test with `source: 'convention'` and confidence 0.6 — assert `(may need adjustment)`. Unit test with monorepo context (2 packages) — assert Packages section lists both with their commands.
  - Done when: CLAUDE.md contains actionable, executable commands with source annotations; monorepo packages listed

- [ ] **Task 19: End-to-end integration test**
  - Description: Write an integration test that creates a temporary directory with a realistic project structure (e.g., a pnpm monorepo with two packages — one Next.js + vitest, one Express + jest), runs `scan()` against it, and verifies: (1) workspace detection finds both packages, (2) root `context.commands` has taskrunner or root-level commands, (3) each package has correct per-package `context.commands`, (4) generated `constraints.yaml` uses actual commands not hardcoded guesses, (5) CLAUDE.md output contains a Commands section with correct commands and source annotations. Additionally test: (6) a single-package Go project with a Makefile — verify Makefile commands override conventions, (7) a project with `.reins/commands.yaml` declaring `test: "dx test"` — verify user declaration overrides auto-detected command, (8) a project with a README containing `## Testing\n\`\`\`bash\nmyco test\n\`\`\`` but no scripts — verify doc extraction fills the gap.
  - Files: `src/scanner/integration.test.ts`
  - Tests: This task IS the test — assert all 8 verification points pass
  - Done when: Monorepo, Go+Makefile, user-declaration, and doc-extraction scenarios all pass; 6-layer priority chain verified end-to-end
