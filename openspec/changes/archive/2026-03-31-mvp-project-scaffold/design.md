## Approach

Bootstrap a Node.js CLI package using pnpm, TypeScript strict mode, and Commander.js. The project is structured so each subsequent module lives in its own `src/` subdirectory with a clear index entry. Config loading is the only runtime logic in this change; all other module stubs are empty directories with placeholder index files.

## Architecture

**Entry point**: `src/cli.ts` creates a Commander.js `program`, sets the binary name to `reins`, version from `package.json`, and registers subcommand placeholders. Each subcommand is a Commander `.command()` that imports its handler from the relevant module directory. For MVP, only `init` is wired; others are registered but throw "not yet implemented".

**Config module** (`src/state/config.ts`):
- Exports `ReinsConfig` interface covering all sections from `modules/01-cli-state.md`: `scan`, `develop`, `learn`, `update`, `hooks`, `status`, `evaluation`
- `getDefaultConfig(): ReinsConfig` returns hardcoded defaults matching the spec
- `loadConfig(projectRoot: string): ReinsConfig` reads `.reins/config.yaml` and `.reins/config.local.yaml` with `js-yaml`, then deep-merges: `defaults → team config → local config`
- Deep merge is a plain recursive function, no external library

**Build pipeline**:
- `tsc` compiles to `dist/` with `tsconfig.build.json` (excludes tests)
- `vitest` runs tests from `src/**/*.test.ts`
- `package.json` `bin` field points to `dist/cli.js`

## Key Decisions

- **pnpm over npm/yarn**: Matches the target project's expected package manager and produces a lockfile that is deterministic and fast in CI
- **Commander.js over yargs/oclif**: Lighter weight, no plugin system needed at MVP; Commander's fluent API matches the command structure in module ①
- **vitest over jest**: No transform config needed for ESM TypeScript; faster cold start; compatible with the `vite`/`vitest` ecosystem that downstream projects commonly use
- **Strict tsconfig from day one**: `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true` — easier to loosen later than to add strict checks to an existing codebase
- **`js-yaml` for config parsing**: Already a transitive dependency of many tools; small and battle-tested; no need for a full YAML processor
- **No dependency injection framework**: Config is loaded via a plain function and passed explicitly; avoids hidden coupling at this stage

## File Structure

```
reins/
├── package.json                    # name: reins, bin: { reins: dist/cli.js }
├── pnpm-lock.yaml
├── tsconfig.json                   # base config (includes tests)
├── tsconfig.build.json             # extends tsconfig.json, excludes *.test.ts
├── vitest.config.ts
├── .gitignore
└── src/
    ├── cli.ts                      # Commander.js entry, registers all commands
    ├── state/
    │   ├── config.ts               # ReinsConfig interface + loadConfig()
    │   ├── manifest.ts             # stub (implemented in mvp-scanner-core)
    │   └── snapshot.ts             # stub (implemented in mvp-reins-init)
    ├── scanner/
    │   └── index.ts                # stub (implemented in mvp-scanner-core)
    ├── constraints/
    │   └── index.ts                # stub (implemented in mvp-constraint-engine)
    ├── context/
    │   └── index.ts                # stub (implemented in mvp-context-layers)
    └── adapters/
        └── index.ts                # stub (implemented in mvp-output-adapters)
```
