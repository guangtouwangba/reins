## Why

The reins CLI has no TypeScript project foundation — no build system, no entry point, no module structure. Every subsequent MVP change depends on a working project scaffold with correct tooling configured from the start.

## What Changes

- Initialize pnpm project with `package.json`, TypeScript, and Commander.js
- Configure `tsconfig.json` with strict mode and path aliases
- Configure vitest for unit testing
- Add build scripts (`build`, `dev`, `test`, `lint`, `typecheck`)
- Create `src/cli.ts` as the Commander.js entry point with `reins` binary
- Create `src/state/config.ts` for config loading (merges config.yaml + config.local.yaml + defaults)
- Establish source directory structure: `src/{cli.ts, scanner/, constraints/, context/, adapters/, state/}`
- Add `.gitignore`, `README.md` stub, and `tsconfig.build.json` for dist output

## Capabilities

### New Capabilities

- `project-scaffold`: TypeScript project with pnpm, Commander.js CLI, vitest, strict tsconfig, and build pipeline
- `cli-entry`: `src/cli.ts` registers the `reins` binary and routes subcommands via Commander.js
- `config-loading`: `src/state/config.ts` loads and deep-merges `.reins/config.yaml`, `.reins/config.local.yaml`, and built-in defaults into a typed `ReinsConfig` object

### Modified Capabilities

None — this is a greenfield scaffold.

## Impact

- All subsequent MVP changes (`mvp-scanner-core`, `mvp-constraint-engine`, `mvp-context-layers`, `mvp-output-adapters`, `mvp-reins-init`) depend on this scaffold
- Sets the TypeScript compilation target and module resolution strategy for the entire project
- Establishes pnpm as the package manager; all dependency commands use pnpm
- `src/state/config.ts` exports `ReinsConfig` and `loadConfig()` — the public contract all modules rely on for runtime configuration
