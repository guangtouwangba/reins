## Tasks

- [ ] **Task 1: Initialize pnpm project**
  - Description: Run `pnpm init` and set `name: "reins"`, `version: "0.1.0"`, `type: "module"`. Add `bin: { "reins": "dist/cli.js" }`. Add scripts: `build`, `dev`, `test`, `lint`, `typecheck`.
  - Files: `package.json`
  - Tests: `pnpm install` completes without errors
  - Done when: `package.json` is valid JSON with correct `bin` and `scripts` fields

- [ ] **Task 2: Configure TypeScript**
  - Description: Create `tsconfig.json` with `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `moduleResolution: "bundler"`, `target: "ES2022"`, `outDir: "dist"`. Create `tsconfig.build.json` that extends base and excludes `**/*.test.ts`.
  - Files: `tsconfig.json`, `tsconfig.build.json`
  - Tests: `pnpm typecheck` exits 0 on the stub source files
  - Done when: Both tsconfig files present; `tsc --noEmit` passes on empty stubs

- [ ] **Task 3: Configure vitest**
  - Description: Create `vitest.config.ts` pointing at `src/**/*.test.ts`. No transform config needed — vitest handles TypeScript natively.
  - Files: `vitest.config.ts`
  - Tests: `pnpm test` runs and exits 0 (no test files yet = 0 tests pass)
  - Done when: `pnpm test` does not error on missing config

- [ ] **Task 4: Install dependencies**
  - Description: Add runtime deps `commander`, `js-yaml`. Add dev deps `typescript`, `vitest`, `@types/node`, `@types/js-yaml`, `tsx`.
  - Files: `package.json`, `pnpm-lock.yaml`
  - Tests: `node -e "require('commander')"` exits 0 after install
  - Done when: `pnpm install` succeeds and lockfile is committed

- [ ] **Task 5: Create CLI entry point**
  - Description: Create `src/cli.ts` using Commander.js. Register program name `reins`, version from package.json. Add `init` command placeholder: `program.command('init').description('Initialize project constraints').action(() => { console.log('reins init — not yet implemented') })`. Export `program` for testing.
  - Files: `src/cli.ts`
  - Tests: `tsx src/cli.ts --help` prints usage; `tsx src/cli.ts --version` prints `0.1.0`
  - Done when: `--help` output includes `init` command listing

- [ ] **Task 6: Create ReinsConfig interface and loadConfig()**
  - Description: Create `src/state/config.ts`. Define `ReinsConfig` interface with all sections from module ①: `scan`, `develop`, `learn`, `update`, `hooks`, `status`, `evaluation`. Implement `getDefaultConfig()` returning defaults matching `modules/01-cli-state.md`. Implement `loadConfig(projectRoot: string): ReinsConfig` that reads optional `.reins/config.yaml` and `.reins/config.local.yaml`, then deep-merges: defaults → team → local.
  - Files: `src/state/config.ts`
  - Tests: Unit test that `loadConfig('/tmp/empty-dir')` returns defaults; unit test that a local config file overrides one field while leaving others at defaults
  - Done when: Both unit tests pass; `tsc --noEmit` reports 0 errors on this file

- [ ] **Task 7: Create module stub files**
  - Description: Create empty stub `index.ts` files in `src/scanner/`, `src/constraints/`, `src/context/`, `src/adapters/`. Each exports an empty object or a `// TODO` comment so TypeScript does not error on the empty module. Also create `src/state/manifest.ts` and `src/state/snapshot.ts` stubs.
  - Files: `src/scanner/index.ts`, `src/constraints/index.ts`, `src/context/index.ts`, `src/adapters/index.ts`, `src/state/manifest.ts`, `src/state/snapshot.ts`
  - Tests: `pnpm typecheck` exits 0 across all stubs
  - Done when: All 6 stub files exist and typecheck passes

- [ ] **Task 8: Add .gitignore and validate full build**
  - Description: Create `.gitignore` with `node_modules/`, `dist/`, `.reins/config.local.yaml`, `.reins/manifest.json`, `.reins/context.json`, `.reins/snapshots/`, `.reins/logs/`. Run full build and confirm `dist/cli.js` is produced and executable.
  - Files: `.gitignore`
  - Tests: `pnpm build` exits 0; `node dist/cli.js --help` prints usage
  - Done when: `node dist/cli.js --version` prints `0.1.0` and `node dist/cli.js --help` lists `init`
