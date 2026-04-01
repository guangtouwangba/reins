## Approach

Split into five independent sub-systems that compose at the scan orchestrator level:

1. **Workspace Discovery** — detects monorepo boundaries and enumerates packages before any sub-detector runs
2. **Command Resolution** — resolves executable commands per language via a 7-layer priority chain after stack detection completes
3. **Skill Matching** — matches command-type skills from `~/.dev-harness/global-skills/` to the project by signal files or dependencies, pre-populating commands without interactive prompts
4. **User Declaration** — loads `.reins/commands.yaml` as the highest-priority override for commands that cannot be auto-detected (internal CLI tools, enterprise wrappers)
5. **Documentation Extraction** — extracts commands from README.md / CONTRIBUTING.md code blocks as a medium-confidence source

All plug into the existing `scan()` pipeline as new phases. Existing sub-detectors (`detectStack`, `detectTests`, `detectRules`, `analyzePatterns`) are unchanged in logic — they only receive scoped inputs when called in per-package mode. The `contextRoot` parameter rename is mechanical: `projectRoot` → `contextRoot` in function signatures, with all call sites updated.

## Architecture

**Scan pipeline (extended)**:

```
scan(projectRoot, depth, config)
  → directoryScanner.scan()                    → { files, dirs, manifest }         [existing]
  → workspaceDetector.detect(projectRoot, filePaths, dirPaths)                      [NEW]
      → try each resolver in priority order
      → return PackageEntry[] (empty for non-monorepos)
  → detectStack(filePaths, projectRoot, 'L0')                                      [existing]
  → detectTests(filePaths, projectRoot, 'L0')                                      [existing]
  → detectStack(filePaths, projectRoot, 'L1')                                      [existing, if depth >= L1]
  → detectTests(filePaths, projectRoot, 'L1')                                      [existing, if depth >= L1]
  → detectRules(filePaths, projectRoot)                                             [existing, if depth >= L1]
  → docExtractor.extract(projectRoot, filePaths)                                    [NEW]
      → scan README.md, CONTRIBUTING.md for commands in code blocks
      → return Partial<CommandMap> (confidence: 0.7)
  → commandResolver.resolve(projectRoot, filePaths, context.stack, docCommands)     [NEW]
      → layer 1-5: convention → makefile → docs → scripts → taskrunner
  → skillMatcher.match(projectRoot, filePaths, context)                              [NEW]
      → scan ~/.dev-harness/global-skills/ for matching command skills
      → fill null slots in context.commands (layer 6)
  → userCommands.load(projectRoot)                                                  [NEW]
      → read .reins/commands.yaml if exists
      → override context.commands with user declarations (layer 7)
  → analyzePatterns(filePaths, dirPaths)                                            [existing, if depth >= L2]
  → for each package in PackageEntry[]:                                             [NEW]
      → scopedFiles = filePaths.filter(f => startsWith(pkg.path + '/'))
                                .map(f => f.slice(pkg.path.length + 1))
      → scopedDirs  = dirPaths.filter/map (same)
      → pkgContext = emptyCodebaseContext()
      → detectStack(scopedFiles, join(projectRoot, pkg.path), 'L0')
      → detectStack(scopedFiles, join(projectRoot, pkg.path), 'L1')
      → detectTests(scopedFiles, join(projectRoot, pkg.path), 'L0')
      → detectTests(scopedFiles, join(projectRoot, pkg.path), 'L1')
      → detectRules(scopedFiles, join(projectRoot, pkg.path))
      → commandResolver.resolve(join(projectRoot, pkg.path), scopedFiles, pkgStack)
      → analyzePatterns(scopedFiles, scopedDirs)
      → context.packages.push({ name, path, context: pkgContext })
  → userCommands.applyPackageOverrides(projectRoot, context.packages)               [NEW]
      → read .reins/commands.yaml packages section
      → override per-package commands
  → write context.json, manifest.json, patterns.json
```

### Sub-module: Workspace Detector (`src/scanner/workspace-detector.ts`)

Exports `detectWorkspaces(projectRoot, filePaths, dirPaths): PackageEntry[]`.

Internally maintains a `WORKSPACE_RESOLVERS` array — tried in order, first match wins:

```typescript
interface WorkspaceResolver {
  name: string;
  detect(projectRoot: string, filePaths: string[]): boolean;
  resolve(projectRoot: string): PackageEntry[];
}

interface PackageEntry {
  name: string;    // from config (package.json#name, Cargo.toml [package] name, etc.) or dirname
  path: string;    // relative to projectRoot, e.g. "packages/api"
  marker: string;  // the file that marks this as a package: "package.json", "go.mod", etc.
}
```

**Resolver implementations:**

| Resolver | `detect()` | `resolve()` |
|----------|------------|-------------|
| `pnpmResolver` | `pnpm-workspace.yaml` exists | Parse YAML `packages` globs → expand → filter dirs containing `package.json` → read `name` from each |
| `npmYarnResolver` | Root `package.json` has `workspaces` field | Parse `workspaces` array → expand globs → filter dirs containing `package.json` → read `name` |
| `goWorkResolver` | `go.work` exists | Parse `use` directives (line-based, not full Go parser) → filter dirs containing `go.mod` → read module path from `go.mod` first line |
| `cargoResolver` | Root `Cargo.toml` contains `[workspace]` | Parse TOML `workspace.members` globs → expand → filter dirs containing `Cargo.toml` with `[package]` → read `package.name` |
| `uvResolver` | `pyproject.toml` contains `[tool.uv.workspace]` | Parse TOML `tool.uv.workspace.members` globs → expand → filter dirs containing `pyproject.toml` → read `project.name` |
| `poetryResolver` | `pyproject.toml` has `tool.poetry.group.*.dependencies` with `path =` entries | Extract path entries → resolve relative paths → filter existing dirs with `pyproject.toml` → read `tool.poetry.name` |
| `dartPubResolver` | Root `pubspec.yaml` has `workspace` field | Parse YAML `workspace` list → expand globs (Dart 3.11+) → filter dirs with `pubspec.yaml` containing `resolution: workspace` → read `name` |
| `melosResolver` | `melos.yaml` exists | Parse YAML `packages` globs → expand → filter dirs containing `pubspec.yaml` → read `name` |

**Glob expansion:** Use the existing `glob` dependency (already used by `directory-scanner.ts`). All resolvers share a `expandGlobs(root, patterns): string[]` utility that expands patterns like `packages/*` into actual directory paths.

**Fallback when no workspace config exists:** If no resolver matches but `pattern-analyzer.ts` already detected `monorepo` (directories named `packages/`, `apps/`, `modules/`), fall back to a directory-scan heuristic: find subdirectories of those paths that contain any known project marker (`package.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`, `pubspec.yaml`).

### Sub-module: Command Resolver (`src/scanner/command-resolver.ts`)

Exports `resolveCommands(contextRoot, filePaths, stack): CommandMap`.

```typescript
interface CommandMap {
  install:     ResolvedCommand | null;
  dev:         ResolvedCommand | null;
  build:       ResolvedCommand | null;
  lint:        ResolvedCommand | null;
  lintFix:     ResolvedCommand | null;
  typecheck:   ResolvedCommand | null;
  format:      ResolvedCommand | null;
  formatCheck: ResolvedCommand | null;
  test:        ResolvedCommand | null;
  testSingle:  ResolvedCommand | null;
  testWatch:   ResolvedCommand | null;
  clean:       ResolvedCommand | null;
}

interface ResolvedCommand {
  command:    string;
  source:     'user' | 'skill' | 'script' | 'taskrunner' | 'docs' | 'makefile' | 'convention';
  confidence: number;  // 0-1
}
```

Resolution follows a 7-layer override chain (later layers override earlier):

```
Layer 1: Language convention defaults          (confidence: 0.6)     goResolver, rustResolver, etc.
Layer 2: Makefile target parsing               (confidence: 0.9)     parseMakefileTargets()
Layer 3: Documentation extraction              (confidence: 0.7)     extractCommandsFromDocs()
Layer 4: Package script parsing                (confidence: 1.0)     package.json scripts, pyproject.toml scripts
Layer 5: Taskrunner config parsing             (confidence: 1.0)     turbo.json, nx.json, melos.yaml
Layer 6: Skill matching                        (confidence: 1.0)     ~/.dev-harness/global-skills/
Layer 7: User declaration                      (confidence: 1.0)     .reins/commands.yaml
```

Each layer produces a `Partial<CommandMap>`. Non-null values from higher layers overwrite lower layers. Layers 6 and 7 are applied separately after auto-detection completes. Layer 7 (user declaration) always wins over skills.

**Language convention resolvers:**

`jsResolver(contextRoot, filePaths, stack)`:
- Reads `package.json#scripts` at `contextRoot`
- Maps script keys to CommandMap fields: `dev`→dev, `start`→dev, `build`→build, `lint`→lint, `lint:fix`→lintFix, `lint:check`→lint, `typecheck`→typecheck, `type-check`→typecheck, `tsc`→typecheck, `check:types`→typecheck, `test`→test, `test:ci`→test, `test:watch`→testWatch, `test:dev`→testWatch, `format`→format, `format:check`→formatCheck, `format:write`→format, `prettier`→format, `prettier:check`→formatCheck, `clean`→clean
- Candidate priority: tries each candidate list in order, first match wins
- Command prefix: `npm run` / `yarn` / `pnpm run` / `bun run` based on `stack.packageManager`
- **Derived commands:**
  - `lintFix` missing + `lint` script contains `eslint` → derive `${run} lint -- --fix`
  - `testSingle` missing + `test` script contains `vitest` → derive `${pm} vitest run {file}`
  - `testSingle` missing + `test` script contains `jest` → derive `${pm} jest {file}`
  - `install` always set from packageManager: `pnpm install` / `npm install` / `yarn install` / `bun install`

`goResolver(contextRoot, filePaths)`:
- Convention defaults: `go build ./...`, `go test ./...`, `go test {file}`, `go vet ./...`
- If `.golangci.yml` or `.golangci.yaml` exists: `lint` = `golangci-lint run`, `lintFix` = `golangci-lint run --fix`
- `format` = `gofmt -w .`, `formatCheck` = `gofmt -l .` (or `goimports` if detected)
- `install` = `go mod tidy`
- `clean` = `go clean`

`rustResolver(contextRoot, filePaths)`:
- Convention defaults: `cargo build`, `cargo test`, `cargo test {name}`, `cargo clippy -- -D warnings`, `cargo clippy --fix --allow-dirty`, `cargo fmt`, `cargo fmt --check`, `cargo clean`
- `install` = not applicable (Cargo fetches on build), set to `cargo fetch` with confidence 0.5

`pythonResolver(contextRoot, filePaths)`:
- Detect runner prefix: `uv.lock` exists → `uv run`, `poetry.lock` exists → `poetry run`, else no prefix
- Detect install: `uv.lock` → `uv sync`, `poetry.lock` → `poetry install`, else `pip install -e .`
- Detect lint tool: `ruff.toml` / `.ruff.toml` / `pyproject.toml` has `[tool.ruff]` → ruff; else check for `flake8` in config → flake8
  - ruff: `lint` = `${prefix}ruff check .`, `lintFix` = `${prefix}ruff check . --fix`, `format` = `${prefix}ruff format .`, `formatCheck` = `${prefix}ruff format . --check`
  - flake8: `lint` = `${prefix}flake8`, `lintFix` = null (flake8 has no auto-fix)
- Detect type checker: `mypy.ini` or `[tool.mypy]` → `${prefix}mypy .`; `pyrightconfig.json` or `[tool.pyright]` → `${prefix}pyright`
- Test: `${prefix}pytest`, `testSingle` = `${prefix}pytest {file}`
- Also parse `[project.scripts]` and `[tool.poe.tasks]` in `pyproject.toml` for explicit script commands — these override conventions
- `clean` = `find . -type d -name __pycache__ -exec rm -rf {} +` with confidence 0.5

`flutterResolver(contextRoot, filePaths)`:
- Detect FVM: `.fvmrc` or `.fvm/fvm_config.json` exists → prefix = `fvm flutter`, else `flutter`
- Convention defaults: `${flutter} pub get`, `${flutter} run`, `${flutter} build`, `${flutter} test`, `${flutter} test {file}`, `${flutter} analyze`, `dart fix --apply`, `dart format .`, `dart format --set-exit-if-changed .`
- `clean` = `${flutter} clean`

**Makefile parser** (`parseMakefileTargets`):
- Simple line-based parser: match lines starting with `target:` (no leading whitespace, followed by `:`)
- Only extract target names, map known target names to CommandMap fields: `test`→test, `lint`→lint, `build`→build, `dev`→dev, `run`→dev, `fmt`→format, `format`→format, `clean`→clean, `check`→typecheck, `install`→install
- Extract the first command line (indented with tab) as the actual command
- Common in Go and Rust projects

**Taskrunner overlay:**

After language resolution, check for taskrunner configs and override:

- `turbo.json` exists: parse `tasks` (or legacy `pipeline`) → if `tasks.lint` exists → `turbo run lint`; same for `test`, `build`, `typecheck`, `dev`
- `nx.json` exists: parse `targetDefaults` → map target names to commands using `nx run-many --target=<name>` or `nx <target>`
- `melos.yaml` exists (Flutter): parse `scripts` → if `scripts.test` → `melos run test`; same for `analyze`→lint, `format`, etc.

**Monorepo root vs package commands:**

For monorepo roots, if a taskrunner is detected, root-level commands use the taskrunner (`turbo run test`). Per-package commands use the package's own scripts. This gives AI agents the choice: run everything from root via taskrunner, or run a single package's commands directly.

### Sub-module: Skill Matcher (`src/scanner/skill-matcher.ts`)

Exports `matchSkillCommands(projectRoot, filePaths, context): Partial<CommandMap>`.

Scans `~/.dev-harness/global-skills/` for YAML files with `type: commands`. For each skill, checks whether its `match` conditions are satisfied by the current project.

**Skill schema:**

```yaml
# ~/.dev-harness/global-skills/mycompany-toolchain.yaml
name: mycompany-toolchain
type: commands                    # only "commands" type skills are matched here
match:
  signals: ["myco.config.yaml", ".mycorc"]            # file existence
  dependencies: ["@mycompany/cli", "@mycompany/dx"]   # in package.json/pyproject.toml deps
  registry: "@mycompany/*"                             # any dep matching this pattern
  language: ["typescript"]                             # stack.language match
commands:
  install: "myco install"
  dev: "myco serve --hot"
  build: "myco build"
  lint: "myco lint --strict"
  lintFix: "myco lint --strict --fix"
  test: "dx test"
  testSingle: "dx test {file}"
```

**Match interface:**

```typescript
interface CommandSkill {
  name: string;
  type: 'commands';
  match: {
    signals?: string[];        // any of these files exist → match
    dependencies?: string[];   // any of these in project deps → match
    registry?: string;         // glob pattern against dep names → match
    language?: string[];       // any of these in stack.language → match
  };
  commands: Partial<Record<keyof CommandMap, string>>;
}
```

**Match logic:**
- A skill matches if **any** of its match conditions is satisfied (OR logic across condition types).
- Within `signals`, `dependencies`, and `language`, **any** item matching is sufficient (OR within arrays).
- `signals` checks against the `filePaths` array (already available from directory scan).
- `dependencies` checks against parsed dependencies from `context.stack` or `package.json`.
- `registry` is a glob pattern matched against all dependency names.
- `language` checks against `context.stack.language`.
- If multiple skills match, they are merged in alphabetical order by name. Later skills override earlier ones for the same command field.

**Resolution:**
- For each matched skill, each command entry becomes a `ResolvedCommand` with `source: 'skill'`, `confidence: 1.0`.
- Skill commands only fill null slots in the `CommandMap` — they do not override commands already resolved by layers 1-5. This means auto-detected project-specific scripts always beat skill defaults.
- Exception: if a skill command and an auto-detected command conflict, skill wins (layer 6 > layers 1-5). This handles the case where a company wrapper replaces the standard tool (e.g., `myco lint` replaces `eslint`).

**Missing `~/.dev-harness/` directory:** If the directory does not exist, skill matching returns an empty result. No error, no warning.

### Sub-module: User Commands Loader (`src/scanner/user-commands.ts`)

Exports `loadUserCommands(projectRoot): Partial<CommandMap> | null` and `loadUserPackageOverrides(projectRoot): Record<string, Partial<CommandMap>>`.

Reads `.reins/commands.yaml` if it exists:

```yaml
# .reins/commands.yaml — committed to git, team-shared
commands:
  install: "myco install"
  dev: "myco serve --hot"
  build: "myco build"
  lint: "myco lint --strict"
  lintFix: "myco lint --strict --fix"
  test: "dx test"
  testSingle: "dx test {file}"

# Per-package overrides (optional)
packages:
  packages/api:
    test: "dx test --suite=api"
    dev: "myco serve --service=api --port=3001"
  packages/web:
    dev: "myco serve --app=web --port=3000"
```

**Schema:**
- `commands` — flat key-value map where keys are `CommandMap` field names and values are command strings. All entries get `source: 'user'`, `confidence: 1.0`.
- `packages` — map of package paths to partial command overrides. Same key-value format as `commands`.
- Unknown keys are ignored (forward-compatible).
- File is optional — absence means no user overrides.

**Application:** After `resolveCommands()` produces the auto-detected `CommandMap`, `loadUserCommands()` is called. For each non-null entry in the user file, it overwrites the corresponding field in `context.commands`. Same for per-package overrides applied after the per-package scan loop.

Also exports `writeUserCommands(projectRoot, commands, packages?)` — used by `reins init` to persist interactive prompt answers.

### Sub-module: Documentation Extractor (`src/scanner/doc-extractor.ts`)

Exports `extractCommandsFromDocs(projectRoot, filePaths): Partial<CommandMap>`.

Scans markdown files for commands in code blocks near known labels:

**Target files** (checked in order, first 3 found):
- `README.md`, `README.rst`, `readme.md`
- `CONTRIBUTING.md`, `CONTRIBUTING.rst`
- `docs/development.md`, `docs/getting-started.md`

**Extraction logic:**

1. Find headings or bold labels matching known patterns:
   - test: `/(?:run|execute)\s+(?:the\s+)?tests?/i`, `/testing/i`
   - lint: `/(?:run\s+)?lint(?:ing)?/i`, `/code\s+quality/i`
   - dev: `/(?:start|run)\s+(?:the\s+)?(?:dev|development|local)/i`
   - build: `/(?:build|compile)/i`
   - install: `/(?:install|setup)\s+(?:the\s+)?(?:dep|project|environment)/i`
   - format: `/(?:format|formatting)/i`

2. Within 5 lines of a matched label, find inline code (`` `command here` ``) or fenced code blocks (` ```bash `)

3. Validate extracted command: must start with a known command prefix (e.g., `npm`, `pnpm`, `yarn`, `go`, `cargo`, `python`, `pytest`, `flutter`, `dart`, `make`, or any single-word binary name). Reject commands that look like file paths, URLs, or output examples.

4. Map extracted command to CommandMap field based on the label that matched.

**All extracted commands get `source: 'docs'`, `confidence: 0.7`.** This is higher than conventions (docs are project-specific) but lower than scripts (docs may be outdated).

**Edge cases:**
- Multiple commands for the same field: first match wins (closest to the heading).
- Non-markdown README (RST, plain text): skip — not worth the parser complexity.
- Code blocks with `$` prefix: strip the `$` (common in copy-paste examples).

### Sub-module: Interactive Command Init (`src/commands/init.ts` extension)

After `scan()` returns, the `reins init` command checks `context.commands` for null fields. For each null field in the critical set (`lint`, `test`, `build`, `dev`), it prompts the user:

```
Commands detected:
  ✓ install:   pnpm install
  ✓ build:     pnpm build              (from package.json)
  ✗ lint:      not detected
  ✗ test:      not detected
  ✓ typecheck: pnpm typecheck           (from package.json)

? How do you run lint? (leave empty to skip)
> myco lint --strict

? How do you run lint fix? (leave empty to skip)
> myco lint --strict --fix

? How do you run tests? (leave empty to skip)
> dx test

? How do you run a single test file? Use {file} as placeholder. (leave empty to skip)
> dx test {file}

Saved to .reins/commands.yaml
```

**Design decisions:**
- Only prompt for null commands in the critical set: `install`, `dev`, `build`, `lint`, `lintFix`, `test`, `testSingle`. Don't prompt for `format`, `formatCheck`, `testWatch`, `clean` (nice-to-have, not critical).
- For `lintFix`: only prompt if `lint` was answered (the fix variant is meaningless without the check variant).
- For `testSingle`: only prompt if `test` was answered.
- Show already-detected commands with their source so the user has context.
- In non-interactive mode (`--no-input`, non-TTY, CI): skip all prompts silently. Unresolved commands remain null.
- On `reins update`: if `.reins/commands.yaml` already exists, don't re-prompt. The user edits the file manually to change declarations.
- User answers are saved via `writeUserCommands()` and immediately merged into the context before constraint generation and CLAUDE.md output.

### Type Changes (`src/scanner/types.ts`)

New types added:

```typescript
export interface ResolvedCommand {
  command:    string;
  source:     'user' | 'skill' | 'script' | 'taskrunner' | 'docs' | 'makefile' | 'convention';
  confidence: number;
}

export interface CommandMap {
  install:     ResolvedCommand | null;
  dev:         ResolvedCommand | null;
  build:       ResolvedCommand | null;
  lint:        ResolvedCommand | null;
  lintFix:     ResolvedCommand | null;
  typecheck:   ResolvedCommand | null;
  format:      ResolvedCommand | null;
  formatCheck: ResolvedCommand | null;
  test:        ResolvedCommand | null;
  testSingle:  ResolvedCommand | null;
  testWatch:   ResolvedCommand | null;
  clean:       ResolvedCommand | null;
}

export interface PackageInfo {
  name:    string;
  path:    string;
  context: CodebaseContext;
}
```

`CodebaseContext` extended:

```typescript
export interface CodebaseContext {
  stack: StackInfo;
  architecture: ArchitectureInfo;
  conventions: ConventionsInfo;
  existingRules: ExistingRulesInfo;
  testing: TestingInfo;
  structure: { directories: DirectoryEntry[]; files: FileEntry[] };
  keyFiles: KeyFilesInfo;
  commands: CommandMap;        // NEW
  packages: PackageInfo[];     // NEW
}
```

`emptyCodebaseContext()` returns `commands: emptyCommandMap()` and `packages: []`.

### Constraint Generator Changes (`src/constraints/generator.ts`)

`writeConstraintsFile()` changes:

```typescript
// Before (hardcoded):
pipeline: {
  pre_commit: [`${pmRun} lint`, `${pmRun} typecheck`],
  post_develop: [`${pmRun} test`],
}

// After (from context):
pipeline: {
  pre_commit: [
    context.commands.lint?.command,
    context.commands.typecheck?.command,
  ].filter(Boolean),
  post_develop: [
    context.commands.test?.command,
  ].filter(Boolean),
}
```

For monorepo projects, `generateConstraints()` iterates `context.packages` and writes per-package constraint files with `extends`:

```yaml
# packages/api/.reins/constraints.yaml
extends: "../../.reins/constraints.yaml"
version: 1
stack:
  primary_language: typescript
  framework: express
# ... package-specific constraints only
```

### Evaluation Module Consolidation (`src/evaluation/l0-static.ts`)

`detectCommands()` is refactored to read from a pre-computed `CommandMap`:

```typescript
// Before: re-parses package.json independently
export function detectCommands(projectRoot: string): DetectedCommands { ... }

// After: wraps context.commands
export function detectCommands(commands: CommandMap): DetectedCommands {
  return {
    packageManager: '...',  // still needed for display
    lint:      { command: commands.lint?.command ?? null, scriptKey: null },
    typecheck: { command: commands.typecheck?.command ?? null, scriptKey: null },
    test:      { command: commands.test?.command ?? null, scriptKey: null },
  };
}
```

`runL0Static()` updated to accept `CommandMap` or fall back to legacy detection for backward compatibility.

### Context Output (CLAUDE.md generation)

The context generators (`src/context/`) write a Commands section with source annotations:

```markdown
## Commands
- Install: `myco install` (declared)
- Dev: `myco serve --hot` (declared)
- Build: `pnpm build`
- Lint: `myco lint --strict` (declared, fix: `myco lint --strict --fix`)
- Typecheck: `pnpm typecheck`
- Test: `dx test` (declared, single file: `dx test {file}`)
- Format: `pnpm format`
```

Source annotation rules:
- `(declared)` — from `.reins/commands.yaml` (source: `user`)
- `(from docs)` — extracted from README/CONTRIBUTING (source: `docs`)
- `(may need adjustment)` — convention-based with `confidence < 0.7`
- No annotation — auto-detected from scripts/taskrunner (high confidence, no noise)

For monorepos, each package section includes its own commands:

```markdown
## Packages

### packages/api (Express + Jest)
- Test: `dx test --suite=api` (declared)
- Lint: `pnpm --filter @myapp/api lint`

### packages/web (Next.js + Playwright)
- Dev: `myco serve --app=web --port=3000` (declared)
- Test: `pnpm --filter @myapp/web test`
```

## Key Decisions

- **Resolver priority order, first match wins**: A project can only be one kind of workspace. Checking pnpm before npm/yarn prevents double-detection (since pnpm projects also have `package.json` with `workspaces`). Go, Rust, Python, Flutter resolvers don't overlap.
- **Scoped file lists via filter, not re-scanning**: The directory scan runs once at the root. Per-package scanning filters the existing file list by prefix rather than re-walking the filesystem. This keeps monorepo scanning fast — O(files) not O(packages × files).
- **7-layer override chain, not plugin architecture**: Seven fixed layers (convention → makefile → docs → scripts → taskrunner → skill → user) are simpler to reason about than a generic plugin system. Each layer produces `Partial<CommandMap>` and merge is a plain object spread with null filtering. Layers 6 (skill) and 7 (user) are applied separately after auto-detection to guarantee correct override order.
- **Skills as cross-project knowledge distribution**: A company with 20 projects all using `myco lint` installs one skill, and no project ever needs to be asked about `myco`. This is the primary mechanism for eliminating interactive prompts at scale. Skills match by signal files/dependencies, not by project name — portable across all matching projects.
- **User declaration as highest priority (above skills)**: Skills provide organization-wide defaults; `.reins/commands.yaml` provides project-specific overrides. A project that uses `myco lint --strict --experimental` instead of the skill's `myco lint --strict` just adds that one line to `commands.yaml`. Partial declarations are supported: override only what's different.
- **Interactive prompts only for missing commands**: `reins init` doesn't re-confirm auto-detected commands — that would be annoying. It only asks about null fields in the critical set (lint, test, build, dev). This minimizes user friction while closing the gap for undetectable tools.
- **Documentation extraction at confidence 0.7**: README/CONTRIBUTING.md commands are project-specific (higher than conventions at 0.6) but may be outdated (lower than scripts at 1.0). The 0.7 score ensures docs fill gaps where nothing else is detected, but get overridden by any explicit source.
- **Confidence scores on conventions**: Go's `golangci-lint run` is a convention — the tool might not be installed. Marking it with confidence 0.6 lets downstream consumers (CLAUDE.md generator, evaluation runner) decide whether to include it unconditionally or with a caveat. Script-sourced and taskrunner commands get 1.0 because they're explicitly configured by the project.
- **`{file}` placeholder for testSingle**: AI agents need to run a single test file after modifying code. The `{file}` placeholder is a simple string replacement convention — no template engine needed. The CLAUDE.md output shows it literally so the AI knows to substitute.
- **TOML parsing via `smol-toml`**: Needed for `Cargo.toml` and `pyproject.toml`. `smol-toml` is zero-dependency, <10KB, spec-compliant. Avoids pulling in larger TOML parsers.
- **Evaluation module becomes a consumer, not a detector**: `l0-static.ts` currently duplicates command detection. After this change it reads `context.commands` — single source of truth, no divergence risk.
- **Fallback heuristic for monorepos without workspace config**: Some projects have `packages/` directories without formal workspace configuration. The fallback scans those directories for project markers, ensuring monorepo scanning still works for informal setups.

## File Structure

```
src/scanner/
├── scan.ts                    # modified: adds workspace discovery + command resolution + user override + per-package loop
├── types.ts                   # modified: adds CommandMap, ResolvedCommand, PackageInfo; extends CodebaseContext
├── workspace-detector.ts      # NEW: WorkspaceResolver interface + 8 resolver implementations + fallback
├── command-resolver.ts        # NEW: resolveCommands() + 5 language resolvers + makefile parser + taskrunner overlay
├── skill-matcher.ts           # NEW: matchSkillCommands() — ~/.dev-harness/global-skills/ matching
├── user-commands.ts           # NEW: loadUserCommands() + writeUserCommands() — .reins/commands.yaml I/O
├── doc-extractor.ts           # NEW: extractCommandsFromDocs() — README/CONTRIBUTING.md command extraction
├── directory-scanner.ts       # unchanged
├── stack-detector.ts          # modified: projectRoot → contextRoot (rename only)
├── test-detector.ts           # modified: projectRoot → contextRoot (rename only)
├── rule-detector.ts           # modified: projectRoot → contextRoot (rename only)
└── pattern-analyzer.ts        # unchanged

src/commands/
└── init.ts                    # modified: interactive command prompts for unresolved commands after scan

src/constraints/
└── generator.ts               # modified: reads context.commands; per-package constraint generation with extends

src/evaluation/
└── l0-static.ts               # modified: detectCommands() reads CommandMap instead of re-parsing

src/context/
└── *.ts                       # modified: Commands section with source annotations in CLAUDE.md output

.reins/
└── commands.yaml              # NEW (user-created): team-shared command declarations, committed to git
```

## Dependencies

- `smol-toml` (new) — TOML parser for Cargo.toml and pyproject.toml. Zero-dependency, <10KB.
- `js-yaml` (existing) — used for pnpm-workspace.yaml, melos.yaml, pubspec.yaml, .golangci.yml parsing.
- `glob` (existing) — used for workspace glob expansion.
