## Tasks

- [ ] **Task 1: Define CodebaseContext types**
  - Description: Create `src/scanner/types.ts` with the full `CodebaseContext` interface (all 7 dimensions: `stack`, `architecture`, `conventions`, `existingRules`, `testing`, `structure`, `keyFiles`), plus `Manifest`, `DirectoryEntry`, `FileEntry`, and `ManifestDiff` interfaces. Export all from `src/scanner/index.ts`.
  - Files: `src/scanner/types.ts`, `src/scanner/index.ts`
  - Tests: `pnpm typecheck` exits 0; import the interface in a test file and assert shape with `satisfies`
  - Done when: All interfaces match the spec in `modules/02-scanner.md` exactly; no TypeScript errors

- [ ] **Task 2: Implement directory-scanner.ts**
  - Description: Walk the project root using `glob('**/*', { cwd: projectRoot, dot: true })`. Filter out `exclude_dirs` (defaults: `node_modules`, `.git`, `dist`, `build`, `vendor`, `generated`). Build a flat file list and directory tree. Compute SHA-256 hash of sorted `filepath:mtime` strings. Return `{ files, dirs, manifest }`. Write `manifest.json` to `.reins/manifest.json`.
  - Files: `src/scanner/directory-scanner.ts`
  - Tests: Unit test with a temp directory containing known files; assert the file list and hash are stable across identical inputs; assert excluded dirs do not appear in output
  - Done when: Hash is deterministic for the same directory state; `.reins/manifest.json` is written with correct shape

- [ ] **Task 3: Implement stack-detector.ts (L0)**
  - Description: Define `STACK_SIGNALS` (`package.json`→js/ts, `go.mod`→go, `Cargo.toml`→rust, etc.), `FRAMEWORK_SIGNALS` (`next.config.*`→next.js, `vite.config.*`→vite, etc.), and `PACKAGE_MANAGER_SIGNALS` (`pnpm-lock.yaml`→pnpm, `yarn.lock`→yarn, `package-lock.json`→npm). Match against the file list from directory-scanner. Return partial `CodebaseContext.stack`.
  - Files: `src/scanner/stack-detector.ts`
  - Tests: Unit test with a file list containing `package.json` + `pnpm-lock.yaml` + `next.config.ts`; assert `stack.language` includes `typescript`, `stack.framework` includes `next.js`, `stack.packageManager` is `pnpm`
  - Done when: All signal tables implemented; unit tests pass

- [ ] **Task 4: Implement stack-detector.ts (L1 enrichment)**
  - Description: Add `parsePackageJson(projectRoot)` that reads and parses `package.json`, extracts dependencies to detect frameworks (`react`, `vue`, `express`, etc.) and test frameworks (`jest`, `vitest`, `mocha`). Add `parseTsConfig(projectRoot)` that reads `tsconfig.json` and extracts `strict`, `paths`, `target`. Merge into `CodebaseContext.stack` and `CodebaseContext.existingRules.typeCheck`.
  - Files: `src/scanner/stack-detector.ts`
  - Tests: Unit test pointing at a real fixture `package.json` with known deps; assert framework and test framework detected correctly
  - Done when: `parsePackageJson` and `parseTsConfig` handle missing files gracefully (return partial/null); unit tests pass

- [ ] **Task 5: Implement test-detector.ts**
  - Description: Define `TEST_SIGNALS` (`jest.config.*`→jest, `vitest.config.*`→vitest, `pytest.ini`→pytest, `phpunit.xml`→phpunit). Detect test file pattern by checking whether `__tests__/` directories or `*.test.ts` files appear in the file list. Read `package.json` scripts to find the test command. Return partial `CodebaseContext.testing`.
  - Files: `src/scanner/test-detector.ts`
  - Tests: Unit test with file list containing `vitest.config.ts` and `src/foo.test.ts`; assert `testing.framework = 'vitest'` and `testing.pattern = '*.test.ts'`
  - Done when: Framework and pattern detection both work; missing test config returns null/unknown gracefully

- [ ] **Task 6: Implement rule-detector.ts**
  - Description: Detect linter config by checking for `.eslintrc`, `.eslintrc.json`, `.eslintrc.js`, `.eslintrc.yaml`, `eslint.config.js/ts`. Read and parse the first found file. Detect formatter config by checking `.prettierrc*`. Detect CI by checking `.github/workflows/*.yml`. Return `CodebaseContext.existingRules`.
  - Files: `src/scanner/rule-detector.ts`
  - Tests: Unit test with fixture directory containing `.eslintrc.json` with known rules; assert `existingRules.linter` contains those rules; test with no ESLint config returns `existingRules.linter = null`
  - Done when: All four fields (`linter`, `formatter`, `typeCheck`, `cicd`) populated or null; no crash on missing files

- [ ] **Task 7: Implement pattern-analyzer.ts**
  - Description: Implement `inferArchitecturePattern(dirs)` checking for `packages/`/`apps/` (monorepo), docker-compose + multiple service dirs (microservice), 3+ layered names (`api`, `service`, `repository`, `model`, `controller`) (layered), else monolith. Implement `inferNamingConvention(files)` counting camelCase/snake_case/PascalCase patterns in source file names, returning the plurality. Implement `inferFileStructure(dirs)` detecting flat/nested/feature-based/layer-based. Return partial `CodebaseContext.architecture` and `CodebaseContext.conventions`.
  - Files: `src/scanner/pattern-analyzer.ts`
  - Tests: Unit test with dir list `['packages/core/', 'packages/ui/']`; assert `architecture.pattern = 'monorepo'`. Unit test with file list of camelCase files; assert `conventions.naming = 'camelCase'`
  - Done when: All three inference functions implemented with unit tests passing

- [ ] **Task 8: Implement scan() orchestrator and write output artifacts**
  - Description: In `src/scanner/index.ts`, implement `scan(projectRoot: string, depth: 'L0' | 'L0-L1' | 'L0-L2', config: ReinsConfig): Promise<CodebaseContext>`. Call sub-scanners in sequence based on depth. Merge partial results. Write `.reins/context.json` and `.reins/patterns.json`. Accept `depth` parameter and skip L1/L2 scanners accordingly.
  - Files: `src/scanner/index.ts`
  - Tests: Integration test running `scan()` against the reins project root itself; assert `context.stack.language` includes `typescript`; assert output files are written
  - Done when: `scan()` completes on a real project without errors; `context.json` is valid JSON matching `CodebaseContext` shape; depth parameter correctly gates which layers run
