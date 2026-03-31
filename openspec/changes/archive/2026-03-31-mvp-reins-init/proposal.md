## Why

The four MVP modules (scanner, constraint engine, context layers, output adapters) exist as isolated units with no user-facing entry point. Without a wired `reins init` command, there is no way to run the full pipeline. This change connects all modules into a single interactive command that takes a project from zero to fully-configured constraints in one shot.

## What Changes

- Wire `reins init` in `src/cli.ts` to call the full pipeline: `scan()` → `generateConstraints()` → `generateContext()` → `runAdapters()`
- Add `--depth`, `--dry-run`, and `--force` flags to the `init` command
- Implement interactive output: display detected stack, list inferred constraints with severities, prompt for confirmation before writing files
- Create the `.reins/` directory structure in the target project on first run
- Write `src/commands/init.ts` as the command handler that orchestrates the pipeline and manages user interaction

## Capabilities

### New Capabilities

- `reins-init-command`: `reins init [--depth L0-L2] [--dry-run] [--force]` runs the full scan → constraint → context → adapter pipeline against the current working directory, with interactive confirmation before writing any files
- `init-pipeline`: `runInitPipeline(projectRoot, options)` in `src/commands/init.ts` — the non-interactive pipeline function that can be called programmatically (used by tests)
- `interactive-confirmation`: After scanning and generating constraints, displays a summary table (detected stack, N constraints by severity) and prompts the user to confirm or cancel before writing any files to disk
- `dry-run-mode`: `--dry-run` flag runs the full pipeline and prints what would be written without touching the filesystem
- `reins-directory-scaffold`: Creates `.reins/` with the correct subdirectory structure (`hooks/`, `patterns/`, `snapshots/`, `logs/`, `skills/`) and writes an initial `config.yaml` with defaults and a `README.md` explaining the directory layout

### Modified Capabilities

- `cli-entry` (from mvp-project-scaffold): `reins init` stub is replaced with the full implementation; Commander.js `.action()` now calls `src/commands/init.ts`

## Impact

- This is the first end-to-end runnable command; it exercises all five preceding MVP changes in sequence
- Files written to the target project: `.reins/` directory tree, `.reins/constraints.yaml`, `.reins/context.json`, `.reins/manifest.json`, `CLAUDE.md` (or injected section), per-directory `AGENTS.md` files, `.reins/patterns/*.md`, `.cursorrules`, `.github/copilot-instructions.md`, `.windsurfrules`
- `--force` overwrites existing constraint files; default behavior (no flag) skips files that already exist with a warning
- The interactive prompt requires a TTY; in non-TTY environments (CI, pipes) the command auto-confirms and proceeds without prompting
