## Why

Different AI coding tools consume constraints in different file formats. Without adapters, teams using Cursor, GitHub Copilot, or Windsurf alongside Claude Code get no benefit from reins-generated constraints. The adapter layer ensures `constraints.yaml` becomes the single source of truth that any tool can consume.

## What Changes

- Define the `Adapter` interface: `name`, `outputPath`, `generate(constraints, context): string`
- Implement five adapters: `claude-md.ts`, `agents-md.ts`, `cursor-rules.ts`, `copilot-instructions.ts`, `windsurf-rules.ts`
- Implement `runAdapters(projectRoot, constraints, context, adapters)` orchestrator that writes each adapter's output to its target path
- `cursor-rules.ts` → `.cursorrules` at project root
- `copilot-instructions.ts` → `.github/copilot-instructions.md`
- `windsurf-rules.ts` → `.windsurfrules` at project root

## Capabilities

### New Capabilities

- `adapter-interface`: `Adapter` interface with `name: string`, `outputPath: string`, `generate(constraints: Constraint[], context: CodebaseContext): string` — adding support for a new AI tool requires only one new file implementing this interface
- `claude-md-adapter`: Generates Claude Code-optimized `CLAUDE.md` format with critical constraints in the standard reins layout (delegates to context-layers L0 generator for consistency)
- `agents-md-adapter`: Generates directory-scoped `AGENTS.md` files for Claude Code and Codex using the L1 generator format
- `cursor-rules-adapter`: Generates `.cursorrules` with all active constraints formatted as numbered rules, critical constraints first
- `copilot-instructions-adapter`: Generates `.github/copilot-instructions.md` with constraints formatted in GitHub Copilot's expected markdown structure
- `windsurf-rules-adapter`: Generates `.windsurfrules` with constraints in Windsurf's expected format
- `run-adapters`: `runAdapters(projectRoot, constraints, context, adapters)` iterates adapters, calls `generate()`, creates parent directories as needed, and writes output files

### Modified Capabilities

- `cli-entry` (from mvp-project-scaffold): `reins init` will accept a `--adapters` flag (Phase 3) to select which adapters to run; at MVP all adapters run by default

## Impact

- `.cursorrules`, `.windsurfrules`, `.github/copilot-instructions.md` are new files written to the target project root — they are team-shared and should be committed to git
- `CLAUDE.md` and per-directory `AGENTS.md` are already handled by `mvp-context-layers`; the `claude-md` and `agents-md` adapters in this module are alternative entry points used when calling adapters directly without the full context pipeline
- No new external dependencies — all adapters use string template literals and `fs`
- `mvp-reins-init` calls `runAdapters()` as the fourth and final step of the init pipeline
