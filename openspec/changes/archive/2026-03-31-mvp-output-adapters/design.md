## Approach

Each adapter is a plain object or class implementing the `Adapter` interface. The orchestrator `runAdapters()` loops over them, calls `generate()`, creates any needed parent directories, and writes the result. No adapter has side effects beyond returning a string — file I/O lives entirely in the orchestrator. This makes adapters trivially unit-testable by asserting on the returned string.

## Architecture

**`src/adapters/base-adapter.ts`** — the shared interface and orchestrator:
```typescript
export interface Adapter {
  name: string;
  outputPath: string;  // relative to projectRoot
  generate(constraints: Constraint[], context: CodebaseContext): string;
}

export function runAdapters(
  projectRoot: string,
  constraints: Constraint[],
  context: CodebaseContext,
  adapters: Adapter[]
): AdapterResult[]
```
`AdapterResult` = `{ adapter: string; path: string; written: boolean; skipped: boolean; reason?: string }`.

The orchestrator creates parent directories (`mkdir -p` equivalent) before writing. If a file already exists and its content is identical to the generated output, it is skipped (no unnecessary disk writes or dirty git status).

**`src/adapters/claude-md.ts`** — `ClaudeMdAdapter`:
- `outputPath`: `CLAUDE.md`
- `generate()`: renders the same format as `l0-generator.ts` (critical constraints, stack overview, commands, map, footer). Does not re-call the l0-generator directly to avoid a circular dependency — the format is duplicated as a template here. At Phase 2, this can be refactored to share the template.
- Severity filter: critical constraints only; all others omitted from this file (L1/L2 is handled by other adapters)

**`src/adapters/agents-md.ts`** — `AgentsMdAdapter`:
- `outputPath`: not a single path — this adapter uses a special `generateAll(projectRoot, constraints, context)` method that writes multiple files. The base `outputPath` is set to `AGENTS.md` as a nominal value.
- `generate()`: returns the AGENTS.md content for the root directory only (global-scoped important constraints)
- The full per-directory behavior is exposed via `generateAll()` which delegates to the L1 generator format

**`src/adapters/cursor-rules.ts`** — `CursorRulesAdapter`:
- `outputPath`: `.cursorrules`
- `generate()`: renders all constraints (critical first, then important, then helpful) as a numbered markdown list. Header: `# {projectName} Development Rules`. Each rule: `{N}. {constraint.rule}` with severity label in parentheses. No token budget limit — Cursor reads this file on demand.
- Format: plain text markdown optimized for Cursor's parser

**`src/adapters/copilot-instructions.ts`** — `CopilotInstructionsAdapter`:
- `outputPath`: `.github/copilot-instructions.md`
- `generate()`: renders constraints in GitHub Copilot's expected format. Header section with project overview. Sections grouped by severity: `## Critical Rules`, `## Important Rules`, `## Helpful Guidelines`. Each rule as a bullet point. Footer with pointer to `.reins/constraints.yaml`.
- Creates `.github/` directory if absent

**`src/adapters/windsurf-rules.ts`** — `WindsurfRulesAdapter`:
- `outputPath`: `.windsurfrules`
- `generate()`: renders all active constraints as a flat rule list in Windsurf's expected format (similar to `.cursorrules` but with Windsurf-specific header comment). Critical constraints marked with `[REQUIRED]`, important with `[IMPORTANT]`, helpful with `[GUIDELINE]`.

**Default adapter set**: `src/adapters/index.ts` exports `DEFAULT_ADAPTERS: Adapter[]` containing all five adapters. `mvp-reins-init` imports this and passes it to `runAdapters()`.

## Key Decisions

- **Adapters return strings, orchestrator does I/O**: Keeps adapters pure and independently testable without touching the filesystem
- **Duplicate template in claude-md adapter, not a shared import from context/**: Avoids a cross-module import that would couple the adapter package to the context package; acceptable duplication at MVP scale
- **`agents-md` adapter has a `generateAll()` extension method**: The base `Adapter` interface requires a single output path; the agents-md adapter is a special case with multiple outputs. Rather than breaking the interface, it extends it with an optional method that `runAdapters()` detects and invokes
- **Idempotent writes (skip if unchanged)**: Prevents unnecessary git diffs when running `reins init` a second time with no changes to the project; makes the tool safe to run repeatedly
- **No adapter selection flags at MVP**: All five adapters always run; adapter selection (`--adapters cursor,copilot`) is a Phase 3 feature

## File Structure

```
src/adapters/
├── base-adapter.ts           # Adapter interface + runAdapters() orchestrator
├── claude-md.ts              # CLAUDE.md adapter (Claude Code)
├── agents-md.ts              # AGENTS.md adapter (Claude Code / Codex)
├── cursor-rules.ts           # .cursorrules adapter (Cursor)
├── copilot-instructions.ts   # .github/copilot-instructions.md (GitHub Copilot)
├── windsurf-rules.ts         # .windsurfrules adapter (Windsurf)
└── index.ts                  # DEFAULT_ADAPTERS export
```
