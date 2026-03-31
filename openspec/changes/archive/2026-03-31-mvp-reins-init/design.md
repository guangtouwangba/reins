## Approach

A dedicated `src/commands/init.ts` module contains the full pipeline logic, keeping `src/cli.ts` thin. The pipeline function `runInitPipeline()` is synchronous in structure (async/await) and accepts an `options` object so it can be called from tests without going through Commander.js. Interactive output uses `process.stdout.write` directly — no UI library — with simple ANSI escape codes for the check marks and status symbols matching the interaction design in `08-interaction-design.md`.

## Architecture

**`src/cli.ts`** (modified):
```typescript
program
  .command('init')
  .description('Initialize project constraints')
  .option('--depth <depth>', 'Scan depth: L0, L0-L1, or L0-L2', 'L0-L2')
  .option('--dry-run', 'Preview changes without writing files', false)
  .option('--force', 'Overwrite existing constraint files', false)
  .action((opts) => initCommand(process.cwd(), opts))
```

**`src/commands/init.ts`**:

```
initCommand(projectRoot, opts)
  1. loadConfig(projectRoot)                     // merge reins.config.yaml + defaults
  2. scaffoldReinsDirs(projectRoot)               // create .reins/ structure if absent
  3. print("Scanning project...")
  4. context = await scan(projectRoot, opts.depth, config)
  5. printScanSummary(context)                    // "✓ Stack: TypeScript + Next.js..."
  6. constraints = generateConstraints(context, projectRoot)
  7. printConstraintSummary(constraints)          // "Inferred N constraints: X critical..."
  8. if !opts.dryRun && isTTY: confirmed = await confirm()
  9. if !confirmed: print("Aborted."); return
  10. if opts.dryRun: printDryRunPlan(context, constraints); return
  11. writeConstraintsFile(projectRoot, constraints, context)
  12. generateContext(projectRoot, constraints, context, opts.depth)
  13. runAdapters(projectRoot, constraints, context, DEFAULT_ADAPTERS)
  14. printCompletionSummary(results)
```

**`scaffoldReinsDirs(projectRoot)`**:
- Creates `.reins/` if absent
- Creates subdirs: `.reins/hooks/`, `.reins/patterns/`, `.reins/snapshots/`, `.reins/logs/`, `.reins/skills/auto/`
- Writes `.reins/config.yaml` with default config (only if absent — never overwrite user's config)
- Writes `.reins/README.md` explaining each subdirectory (only if absent)
- Appends `.reins/config.local.yaml`, `.reins/manifest.json`, `.reins/context.json`, `.reins/snapshots/`, `.reins/logs/`, `.reins/skills/auto/` to `.gitignore` if not already present

**Interactive output format** (matching `08-interaction-design.md`):
```
Scanning project...

  ✓ Stack: TypeScript + Next.js 14
  ✓ Package manager: pnpm
  ✓ Test framework: vitest
  ✓ Lint: ESLint + Prettier
  ✓ Architecture: layered (api / services / repositories)

  Inferred 8 constraints:
    3 critical  • 4 important  • 1 helpful

  Files to write:
    .reins/constraints.yaml
    CLAUDE.md
    src/AGENTS.md
    lib/AGENTS.md
    .cursorrules
    .github/copilot-instructions.md
    .windsurfrules

  Proceed? [Y/n]
```

**Dry-run output**: prints the same summary plus the full content of each file that would be written, without touching disk. Uses a `--dry-run` section header per file.

**Non-TTY behavior**: `process.stdout.isTTY === false` → skip the confirmation prompt, proceed automatically. Print `(non-interactive mode, auto-confirming)` before proceeding.

**`.gitignore` patching**: Read existing `.gitignore`, check if reins personal-file entries are already present, append a `# reins (personal files — do not commit)` block if any are missing. Never remove existing entries.

## Key Decisions

- **`process.cwd()` as default projectRoot**: The CLI operates on the current working directory; no `--dir` flag at MVP. Passing `projectRoot` as a parameter to all internal functions enables testing with temp directories.
- **Single confirmation prompt, not per-constraint**: The interaction design shows the user confirming the full plan at once. Per-constraint confirmation (as shown for ambiguous inferences in the spec) is a Phase 2 feature requiring a more sophisticated TUI.
- **`scaffoldReinsDirs` runs before scan**: Creates `.reins/` so that scan can write `manifest.json` and `context.json` into it immediately after completing.
- **`.gitignore` patching over replacement**: Safer than overwriting — preserves project-specific gitignore entries.
- **`runInitPipeline` exported for testing**: The Commander.js action is a thin wrapper; tests import `runInitPipeline` directly and pass a temp dir, avoiding subprocess overhead.

## File Structure

```
src/
├── cli.ts                    # updated: init command wired to initCommand()
└── commands/
    └── init.ts               # initCommand(), runInitPipeline(), scaffoldReinsDirs()
```
