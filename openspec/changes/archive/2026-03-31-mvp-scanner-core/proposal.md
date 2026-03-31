## Why

Without a scanner, `reins init` has no way to understand the target project. The constraint generator needs a structured `CodebaseContext` to produce meaningful rules — guessing from scratch produces generic noise rather than project-specific signal.

## What Changes

- Implement L0 file extension and signal-file scan (`package.json`, `go.mod`, `Cargo.toml`, etc.)
- Implement L1 config file parsing: `package.json` dependencies, `tsconfig.json` strict mode, `.eslintrc` rules, `.github/workflows` CI detection
- Implement L2 directory structure analysis: architecture pattern inference (monorepo/layered/monolith), naming convention detection, file structure classification
- Produce three output artifacts: `context.json` (CodebaseContext), `manifest.json` (directory snapshot), `patterns.json` (detected patterns)
- Expose a single `scan(projectRoot, depth)` entry point that orchestrates all sub-scanners

## Capabilities

### New Capabilities

- `l0-file-scan`: Detects language, framework, test framework, and package manager from signal files and file extensions alone — no file parsing required
- `l1-config-parse`: Extracts structured data from `package.json`, `tsconfig.json`, `.eslintrc*`, and CI workflow files
- `l2-structure-analysis`: Infers architecture pattern (monorepo/microservice/layered/monolith), naming conventions (camelCase/snake_case/PascalCase), file organization style, and import style from directory tree
- `codebase-context`: Produces the `CodebaseContext` interface with all 7 dimensions (stack, architecture, conventions, existingRules, testing, structure, keyFiles)
- `manifest-snapshot`: Produces `manifest.json` — a hashed directory snapshot used for incremental diffing by `reins update`
- `scan-entry`: `scan(projectRoot, depth)` function that runs L0→L2 in sequence and merges results into a single `CodebaseContext`

### Modified Capabilities

- `config-loading` (from mvp-project-scaffold): Scanner reads `scan.depth` and `scan.exclude_dirs` from `ReinsConfig` to control scan behavior

## Impact

- `mvp-constraint-engine` depends directly on `CodebaseContext` exported from this module
- `mvp-reins-init` calls `scan()` as the first step in the init pipeline
- `manifest.json` written to `.reins/manifest.json`; this file is in `.gitignore` (personal, not team-shared)
- `context.json` written to `.reins/context.json`; also personal/gitignored
- External dependency added: `glob` (file matching) — already common in Node toolchains
