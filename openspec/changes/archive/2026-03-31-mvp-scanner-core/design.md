## Approach

Implement three sequential scan layers behind a single `scan(projectRoot, depth)` entry point. Each layer is a self-contained sub-module that takes the project root and returns a partial `CodebaseContext`. The orchestrator merges the partial results in order (L0 → L1 → L2), with later layers enriching but not overwriting earlier detections. Output artifacts are written to `.reins/` at the end of the scan.

## Architecture

**Entry point** (`src/scanner/index.ts`):
```
scan(projectRoot, depth, config)
  → directoryScanner.scan()         → { files, dirs, manifest }
  → stackDetector.detect(files)     → CodebaseContext.stack (L0)
  → testDetector.detect(files)      → CodebaseContext.testing (L0)
  → stackDetector.parseConfigs()    → CodebaseContext.stack enriched (L1)
  → ruleDetector.detect()           → CodebaseContext.existingRules (L1)
  → patternAnalyzer.analyze(dirs)   → CodebaseContext.architecture + conventions (L2)
  → merge all partials into CodebaseContext
  → write context.json, manifest.json, patterns.json
```

**Sub-modules**:

`src/scanner/directory-scanner.ts` — Walks the project tree using `glob`, respects `exclude_dirs` from config. Produces a flat list of all file paths and a directory tree. Computes a hash of the directory listing for manifest diffing. Writes `manifest.json`.

`src/scanner/stack-detector.ts` — L0: matches signal filenames (`package.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`, `build.gradle`, framework config files) against `STACK_SIGNALS` and `FRAMEWORK_SIGNALS` lookup tables. L1: parses `package.json` for `dependencies`/`devDependencies` to detect frameworks and package manager (by presence of lockfiles: `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`). Parses `tsconfig.json` for `strict` mode.

`src/scanner/test-detector.ts` — L0: matches `TEST_SIGNALS` filenames. L1: examines `package.json` scripts for test commands. Detects test file pattern by sampling directory structure (`__tests__/`, `*.test.ts`, `*_test.go`).

`src/scanner/rule-detector.ts` — L1: reads `.eslintrc`, `.eslintrc.js`, `.eslintrc.json`, `eslint.config.*`. Reads `.prettierrc*`. Reads `.github/workflows/*.yml` to detect CI presence and pre-commit steps. Returns `CodebaseContext.existingRules`.

`src/scanner/pattern-analyzer.ts` — L2: takes the directory list and applies heuristics:
- Architecture: checks for `packages/`, `apps/`, `docker-compose.yml` + multiple service dirs, layered dir names (`api`, `service`, `repository`, `model`, `controller`)
- Naming: samples source file names, counts camelCase/snake_case/PascalCase patterns, returns the plurality winner
- File structure: flat (few dirs) vs nested vs feature-based (`features/`) vs layer-based
- Import style: not implemented at L2 (requires file reading, deferred to L3)

**CodebaseContext interface** — defined in `src/scanner/types.ts` and re-exported from `src/scanner/index.ts`. All 7 dimensions match the spec exactly.

**Output artifacts**:
- `.reins/context.json` — full `CodebaseContext` as JSON
- `.reins/manifest.json` — `Manifest` with version, timestamp, file list, and SHA-256 hash
- `.reins/patterns.json` — raw detected patterns (named conventions, signal matches) for debugging

## Key Decisions

- **No AST parsing at MVP**: L0-L2 use only file name matching and JSON/YAML parsing. This keeps the scanner fast (< 2 seconds on a typical project) and dependency-free beyond `glob` and `js-yaml`
- **Signal table approach for L0**: Lookup tables (`STACK_SIGNALS`, `FRAMEWORK_SIGNALS`, `TEST_SIGNALS`) are plain objects, easy to extend without changing logic
- **Partial context merge pattern**: Each sub-scanner returns `Partial<CodebaseContext>` and the orchestrator deep-merges. This avoids tight coupling between sub-scanners and makes each independently testable
- **Hash-based manifest**: SHA-256 of sorted file paths + mtimes enables fast incremental diff in `reins update` without re-reading file contents
- **`exclude_dirs` default**: `['node_modules', '.git', 'dist', 'build', 'vendor', 'generated']` — always excluded regardless of config to prevent scanning 100k+ files

## File Structure

```
src/scanner/
├── index.ts                  # scan(projectRoot, depth, config) → CodebaseContext
├── types.ts                  # CodebaseContext, Manifest, all sub-interfaces
├── directory-scanner.ts      # file tree walk, manifest production (L0)
├── stack-detector.ts         # language/framework/package-manager detection (L0-L1)
├── pattern-analyzer.ts       # architecture pattern + naming convention (L2)
├── rule-detector.ts          # eslint/prettier/CI rule extraction (L1)
└── test-detector.ts          # test framework + pattern detection (L0-L1)
```
