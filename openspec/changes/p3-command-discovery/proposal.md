## Why

The scanner knows *what* a project uses (vitest, eslint, pnpm) but not *how to run it*. This is a critical gap: downstream AI agents need executable commands — not framework names — to verify changes, fix lint errors, run tests, and start dev servers. Without command discovery, the generated CLAUDE.md contains guesses like `pnpm run lint` that break when the actual script key is `lint:check`, or contains nothing at all for non-JS projects. The evaluation module (`l0-static.ts`) already has a `detectCommands()` function that solves this for JS — but it's siloed in evaluation, disconnected from the scanner, and covers only one language.

Meanwhile, monorepo projects compound the problem: AI needs to know not just the root-level commands but per-package commands and whether a taskrunner (turbo, nx, melos) orchestrates them. Today the scanner detects `architecture.pattern = 'monorepo'` and stops — it doesn't discover packages, doesn't scan them individually, and doesn't resolve their commands.

A deeper problem: many enterprise projects rely on internal CLI tools (`myco build`, `dx test`, custom wrappers) that leave no trace in the repository. Static file analysis can never discover these. The system needs a user-declaration layer so teams can tell reins about commands that cannot be auto-detected, and an interactive init flow that asks about missing commands rather than silently guessing wrong.

## What Changes

### 1. Workspace Discovery (`src/scanner/workspace-detector.ts`)

Detect and enumerate workspace packages across 5 language ecosystems:

| Ecosystem | Workspace Config | Config Field | Package Marker |
|-----------|-----------------|--------------|----------------|
| JS (pnpm) | `pnpm-workspace.yaml` | `packages` | `package.json` |
| JS (npm/yarn) | `package.json` | `workspaces` | `package.json` |
| Go | `go.work` | `use` directives | `go.mod` |
| Rust | `Cargo.toml` | `[workspace] members` | `Cargo.toml` with `[package]` |
| Python (uv) | `pyproject.toml` | `[tool.uv.workspace] members` | `pyproject.toml` |
| Python (poetry) | `pyproject.toml` | path dependencies | `pyproject.toml` |
| Flutter/Dart | `pubspec.yaml` / `melos.yaml` | `workspace` / `packages` | `pubspec.yaml` |

Each resolver implements a `detect() → boolean` and `resolve() → PackageEntry[]` interface. Resolvers are tried in priority order; the first match wins.

When packages are found, the existing sub-detectors (`detectStack`, `detectTests`, `detectRules`, `analyzePatterns`) run once per package with scoped file lists and a per-package `contextRoot`, producing a full `CodebaseContext` per package.

### 2. Command Resolution (`src/scanner/command-resolver.ts`)

New scanner phase that runs after `detectStack` and produces a `CommandMap` for the root and each package. A `CommandMap` covers the full AI development loop:

```
install → dev → build → lint → lintFix → typecheck → format → formatCheck → test → testSingle → testWatch → clean
```

Each resolved command includes:
- `command` — the actual executable string (`pnpm run lint`, `cargo clippy -- -D warnings`)
- `source` — how it was discovered: `user` (declared in commands.yaml), `script` (parsed from package.json/pyproject.toml), `taskrunner` (turbo/nx/melos), `docs` (extracted from README/CONTRIBUTING.md), `makefile` (parsed Makefile targets), `convention` (language default)
- `confidence` — 0-1; `user` and `script` and `taskrunner` = 1.0, `docs` = 0.7, `makefile` = 0.9, `convention` = 0.6-0.8

Command discovery follows a 6-layer priority chain (later layers override earlier):
1. **Language convention** — fallback defaults per language (lowest priority)
2. **Makefile** targets — explicit command mapping
3. **Documentation extraction** — commands extracted from README.md / CONTRIBUTING.md code blocks
4. **Package scripts** (package.json scripts, pyproject.toml scripts, Cargo aliases) — project-defined
5. **Taskrunner** (turbo.json tasks, nx.json targets, melos.yaml scripts)
6. **User declaration** (`.reins/commands.yaml`) — highest authority, always wins

Per-language resolvers:

- **JS/TS**: Parse `package.json#scripts`, match keys like `lint`, `lint:fix`, `test`, `test:watch`, `dev`, `build`, `typecheck`, `format`. Derive fix commands when missing (e.g., `lint` script contains `eslint` → `lintFix` = append `--fix`). Derive single-file test commands from framework detection (vitest → `vitest run {file}`, jest → `jest {file}`).
- **Go**: Convention-based (`go test ./...`, `go build ./...`) + `.golangci.yml` presence → `golangci-lint run` / `golangci-lint run --fix`. Parse Makefile targets when available.
- **Rust**: Convention-based (`cargo test`, `cargo clippy -- -D warnings`, `cargo fmt --check`). Derive fix variants (`cargo clippy --fix --allow-dirty`).
- **Python**: Detect toolchain (uv/poetry/pip) for command prefix. Detect lint tool (ruff/flake8) and type checker (mypy/pyright) from config files. Parse `[project.scripts]` and `[tool.poe.tasks]` in `pyproject.toml`.
- **Flutter/Dart**: Detect melos vs bare flutter. Detect fvm for SDK version management (`fvm flutter` prefix). Map standard commands (`flutter test`, `flutter analyze`, `dart fix --apply`, `dart format`).

### 3. User-Declared Commands (`.reins/commands.yaml`)

A team-maintained file that explicitly declares commands the auto-detection cannot discover — especially internal CLI tools, custom wrappers, and enterprise-specific toolchains. This file is committed to git and shared across the team.

```yaml
# .reins/commands.yaml
commands:
  install: "myco install"
  dev: "myco serve --hot"
  build: "myco build"
  lint: "myco lint --strict"
  lintFix: "myco lint --strict --fix"
  test: "dx test"
  testSingle: "dx test {file}"
  deploy: "myco deploy staging"

# Per-package overrides for monorepos
packages:
  packages/api:
    test: "dx test --suite=api"
    dev: "myco serve --service=api --port=3001"
  packages/web:
    dev: "myco serve --app=web --port=3000"
```

User-declared commands have the highest priority (Layer 6) and always override auto-detected commands. Partial declarations are supported: a team can declare only `test` and `lint` while letting the scanner auto-detect everything else.

### 4. Documentation Extraction

Commands are often documented in README.md and CONTRIBUTING.md but not in any machine-readable config. A lightweight doc scanner extracts commands from markdown code blocks near known labels ("run tests", "lint", "install dependencies", etc.). Extracted commands have confidence 0.7 — higher than language conventions but lower than package scripts — since documentation may be outdated.

### 5. Interactive Init for Missing Commands

During `reins init`, after auto-detection completes, the CLI prompts for any commands that could not be resolved:

```
Commands detected:
  ✓ install:   pnpm install
  ✓ build:     pnpm build
  ✗ lint:      not detected
  ✗ test:      not detected
  ✓ typecheck: pnpm typecheck

? How do you run lint? (leave empty to skip)
> myco lint --strict

? How do you run tests? (leave empty to skip)
> dx test
```

User answers are saved to `.reins/commands.yaml` automatically. Only unresolved commands are prompted — detected commands are not asked about. In non-interactive mode (CI, piped stdin), prompts are skipped and unresolved commands remain null.

### 6. Type Extensions (`src/scanner/types.ts`)

```typescript
// New types
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
  testSingle:  ResolvedCommand | null;   // contains {file} placeholder
  testWatch:   ResolvedCommand | null;
  clean:       ResolvedCommand | null;
}

interface ResolvedCommand {
  command:    string;
  source:     'user' | 'script' | 'taskrunner' | 'docs' | 'makefile' | 'convention';
  confidence: number;   // 0-1
}

interface PackageInfo {
  name:    string;           // from config or directory name
  path:    string;           // relative, e.g. "packages/api"
  context: CodebaseContext;  // full per-package context including commands
}

// Extended CodebaseContext
interface CodebaseContext {
  // ... existing 7 dimensions unchanged
  commands: CommandMap;       // new: resolved commands for this context
  packages: PackageInfo[];   // new: empty for non-monorepos
}
```

### 7. Scan Pipeline Change

```
scan(projectRoot, depth, config)
  ├─ scanDirectory()                          // existing
  ├─ detectWorkspaces(projectRoot, filePaths) // NEW: package discovery
  ├─ detectStack()                            // existing (root level)
  ├─ detectTests()                            // existing (root level)
  ├─ detectRules()                            // existing (root level)
  ├─ extractCommandsFromDocs()                // NEW: README/CONTRIBUTING.md extraction
  ├─ resolveCommands()                        // NEW: root-level commands (layers 1-5)
  ├─ loadUserCommands()                       // NEW: .reins/commands.yaml override (layer 6)
  ├─ analyzePatterns()                        // existing (root level)
  └─ for each package:                        // NEW: per-package loop
      ├─ scope filePaths to package
      ├─ detectStack(scopedFiles, pkgRoot)
      ├─ detectTests(scopedFiles, pkgRoot)
      ├─ detectRules(scopedFiles, pkgRoot)
      ├─ resolveCommands(scopedFiles, pkgRoot)
      └─ analyzePatterns(scopedFiles, scopedDirs)
  └─ applyUserPackageOverrides()              // NEW: per-package commands.yaml overrides
```

After `scan()` returns, `reins init` checks for unresolved commands (null fields in `CommandMap`). In interactive mode, it prompts the user for each missing command. Answers are saved to `.reins/commands.yaml` and merged into the context.

Sub-detector signature change: `projectRoot` parameter renamed to `contextRoot`. Root-level calls pass `projectRoot`; per-package calls pass `join(projectRoot, pkg.path)`. No logic change inside the detectors — they already use `join(root, 'package.json')` which naturally becomes the correct per-package path.

### 8. Generator Consumption

`constraints/generator.ts` stops hardcoding commands:

```
// Before: pre_commit: [`${pmRun} lint`, `${pmRun} typecheck`]
// After:  pre_commit: [context.commands.lint?.command, context.commands.typecheck?.command].filter(Boolean)
```

### 9. CLAUDE.md Output

Context generators write the resolved commands into the generated CLAUDE.md, giving AI agents an executable reference:

```markdown
## Commands
- Install: `pnpm install`
- Dev: `pnpm dev`
- Build: `pnpm build`
- Lint: `pnpm lint` (fix: `pnpm lint --fix`)
- Typecheck: `pnpm typecheck`
- Test: `pnpm test` (single file: `pnpm vitest run {file}`)
- Format: `pnpm format`
```

For monorepos, per-package commands are also listed.

### 10. Evaluation Module Consolidation

`evaluation/l0-static.ts#detectCommands()` is refactored to consume `context.commands` instead of re-detecting commands independently. The duplicated detection logic is removed.

## Capabilities

### New Capabilities

- `workspace-discovery`: Detect and enumerate workspace packages across JS (pnpm/npm/yarn), Go (go.work), Rust (Cargo workspaces), Python (uv/poetry), and Flutter/Dart (pub workspaces/melos) ecosystems
- `command-resolution`: Resolve executable commands for the full AI development loop (install, dev, build, lint, lintFix, typecheck, format, test, testSingle, testWatch, clean) per language with 6-layer priority chain (convention → makefile → docs → scripts → taskrunner → user declaration)
- `user-declared-commands`: Load `.reins/commands.yaml` as highest-priority command source for internal CLI tools, custom wrappers, and enterprise toolchains that cannot be auto-detected; supports root and per-package overrides
- `doc-command-extraction`: Extract commands from README.md and CONTRIBUTING.md code blocks near known labels (e.g., "run tests", "install dependencies") as a medium-confidence discovery source
- `interactive-command-init`: During `reins init`, prompt for commands that could not be auto-detected; save answers to `.reins/commands.yaml`; skip prompts in non-interactive mode
- `per-package-scanning`: Run all existing sub-detectors (stack, test, rules, patterns) scoped to each workspace package, producing a full `CodebaseContext` per package
- `taskrunner-detection`: Detect monorepo taskrunners (turborepo, nx, melos) and resolve their task definitions as a high-priority command source

### Modified Capabilities

- `scan-entry`: `scan()` gains workspace discovery, doc extraction, command resolution, and user override phases; pipeline becomes `scanDirectory → detectWorkspaces → detectStack → detectTests → detectRules → extractCommandsFromDocs → resolveCommands → loadUserCommands → analyzePatterns → per-package loop → applyUserPackageOverrides`
- `codebase-context`: `CodebaseContext` gains `commands: CommandMap` and `packages: PackageInfo[]` fields; `emptyCodebaseContext()` updated with empty defaults
- `constraint-generation`: `generateConstraints()` reads `context.commands` for pipeline commands instead of hardcoding; generates per-package constraints with `extends` inheritance for monorepos
- `context-output`: CLAUDE.md generators write a Commands section from `context.commands`; user-declared commands annotated with `(declared)`; monorepo projects get per-package command listings
- `l0-static-evaluation`: `detectCommands()` refactored to read from `context.commands` instead of re-parsing `package.json`
- `reins-init`: Init flow extended with interactive command prompts for unresolved commands; writes `.reins/commands.yaml` from user answers

## Impact

- Sub-detector function signatures change: `projectRoot` renamed to `contextRoot` — mechanical rename, no logic change. All call sites updated.
- `CodebaseContext` gains two new fields (`commands`, `packages`) — non-breaking addition; `emptyCodebaseContext()` returns empty defaults
- `.reins/context.json` schema grows — existing consumers that don't read the new fields are unaffected
- Monorepo projects will see per-package `.reins/` directories created inside workspace packages
- New dependency: a YAML parser is already present (`js-yaml`); TOML parsing needed for Cargo.toml and some pyproject.toml files — add `smol-toml` (zero-dependency, <10KB)
- `l0-static.ts` loses its independent `detectCommands()` function — evaluation module gains a dependency on scanner output
- Convention-based command resolution (Go, Rust, Flutter) may produce commands that don't work if the user hasn't installed the tool (e.g., `golangci-lint` not installed) — the `confidence` field signals this to downstream consumers; the interactive init prompt gives users the chance to correct these
- `.reins/commands.yaml` is a new file intended to be committed to git — teams share command declarations. The file is optional; projects with fully auto-detectable commands never need it
- `reins init` becomes interactive by default (prompts for missing commands). Non-interactive mode (CI, piped stdin) skips prompts silently — unresolved commands remain null
- Documentation extraction (README/CONTRIBUTING.md) uses regex-based heuristics — it may extract incorrect commands from unrelated code blocks. Confidence 0.7 ensures these are overridden by any explicit source
- No network access required; all detection is local file-based
